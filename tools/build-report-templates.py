"""สร้างแม่แบบรายงานผลหมาย (.docx) พร้อม {{placeholder}} จากไฟล์ตัวอย่าง Word ของศาล (เครื่องมือสำหรับนักพัฒนา)

ใช้เมื่อต้องการสร้างแม่แบบใหม่จากไฟล์ตัวอย่าง (.doc → แปลงเป็น .docx ด้วย LibreOffice แล้วแตกไฟล์ไว้ในโฟลเดอร์ SAMPLES/<รหัส>/)
  08b63021 = หมายศาล หมายฟรี (แบบปกติ)      16d214ea = หมายศาล ประกาศศาล
  b63ec711 = หมายต่างจังหวัด หมายเงิน      f1d9ade9 = หมายต่างจังหวัด หมายฟรี
  SAMPLES=/path/to/samples python3 tools/build-report-templates.py templates/report
ไฟล์แม่แบบที่ได้ถูก commit ไว้แล้วใน templates/report/ — ใช้งานปกติไม่ต้องรันสคริปต์นี้
"""
import copy, os, re, shutil, sys, zipfile
from lxml import etree
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ns={'w':W}
def q(t): return '{%s}%s'%(W,t)
SRC=os.environ.get('SAMPLES','/home/claude/in/x')
OUT=sys.argv[1] if len(sys.argv)>1 else '/home/claude/out_tpl'
os.makedirs(OUT,exist_ok=True)

class Doc:
    def __init__(s,key):
        s.key=key; s.dir=os.path.join(SRC,key)
        s.tree=etree.parse(os.path.join(s.dir,'word/document.xml'))
        s.ps=list(s.tree.getroot().iter(q('p')))
    def runs(s,pi): return s.ps[pi].findall('w:r',ns)
    def rtext(s,r): return ''.join(x.text or '' for x in r.findall('w:t',ns))
    def settext(s,r,txt):
        ts=r.findall('w:t',ns)
        if not ts:
            t=etree.SubElement(r,q('t')); ts=[t]
        ts[0].text=txt; ts[0].set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        for t in ts[1:]: r.remove(t)
    def rep(s,pi,start,new,n=1,occ=0):
        """หา run ที่ข้อความ == start (ลำดับที่ occ) แล้วแทนด้วย new และล้าง n-1 run ถัดไป"""
        rs=s.runs(pi); hits=[i for i,r in enumerate(rs) if s.rtext(r)==start and r.find('w:t',ns) is not None]
        if len(hits)<=occ: raise Exception(f'{s.key} p{pi}: not found {start!r} in {[s.rtext(r) for r in rs]}')
        i=hits[occ]; s.settext(rs[i],new)
        for j in range(i+1,i+n):
            for t in rs[j].findall('w:t',ns): t.text=''
    def fill_empty(s,pi,new):
        rs=s.runs(pi); assert rs and not s.rtext(rs[0]), (s.key,pi)
        s.settext(rs[0],new)
    def sym(s,pi,nth,key):
        syms=s.ps[pi].findall('.//w:sym',ns); syms[nth].set(q('char'),'{{%s}}'%key)
    def remove_p(s,pi):
        p=s.ps[pi]; p.getparent().remove(p)
    def page_break_before(s,pi):
        p=s.ps[pi]; ppr=p.find('w:pPr',ns)
        e=etree.Element(q('pageBreakBefore'))
        # ต้องอยู่หลัง pStyle/keepNext/keepLines ตาม schema
        idx=0
        for i,c in enumerate(ppr):
            if etree.QName(c).localname in('pStyle','keepNext','keepLines'): idx=i+1
        ppr.insert(idx,e)
        # ลบย่อหน้าว่างก่อนหน้า (ระดับ body) เพื่อไม่ให้เกิดหน้าว่าง
        prev=p.getprevious()
        while prev is not None and prev.tag==q('p') and not ''.join(prev.itertext()).strip() and prev.find('.//w:drawing',ns) is None and prev.find('.//w:pict',ns) is None:
            nxt=prev.getprevious(); prev.getparent().remove(prev); prev=nxt
    def photo(s,pi):
        """แทนรูปตัวอย่างด้วยตัวยึด: ย่อหน้านี้จะถูกทำซ้ำตามจำนวนภาพ"""
        p=s.ps[pi]
        blip=p.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}blip')
        blip.set('{%s}embed'%R,'{{PHOTO_RID}}')
        for e in p.iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}extent','{http://schemas.openxmlformats.org/drawingml/2006/main}ext'):
            e.set('cx','{{PHOTO_CX}}'); e.set('cy','{{PHOTO_CY}}')
        for e in p.iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr','{http://schemas.openxmlformats.org/drawingml/2006/picture}cNvPr'):
            e.set('id','{{PHOTO_ID}}'); e.set('name','Photo {{PHOTO_ID}}')
        # ใส่เครื่องหมายครอบย่อหน้าภาพ ให้ JS หาเจอง่าย
        p.set('{%s}photoBlock'%'urn:slts','1')
    def payer_lines(s,*_):
        """ตารางลายเซ็น ผู้รับเงิน/ผู้จ่ายเงิน (4 แถว x 2 คอลัมน์): ตัดแถวว่าง (แถว 3)
        แล้วเพิ่มแถว (ชื่อผู้จ่ายเงิน) และตำแหน่ง ใต้ "(ลงชื่อ)...ผู้จ่ายเงิน" """
        body=s.tree.getroot().find('w:body',ns)
        tbl=[t for t in body.findall('w:tbl',ns) if 'จ่าย' in ''.join(t.itertext()) and 'ลงชื่อ' in ''.join(t.itertext())][0]
        rows=tbl.findall('w:tr',ns)
        name_row=rows[1]; blank=rows[2]; payer=rows[3]
        tbl.remove(blank)
        def mk(text):
            r=copy.deepcopy(name_row)
            for b in list(r.iter(q('bookmarkStart'),q('bookmarkEnd'))): b.getparent().remove(b)
            cell=r.findall('w:tc',ns)[1]
            runs=cell.findall('.//w:r',ns)
            for x in runs:
                for t in x.findall('w:t',ns): t.text=''
            s.settext(runs[0],text)
            return r
        n1=mk('({{payer_name}})'); n2=mk('{{payer_position}}')
        payer.addnext(n2); payer.addnext(n1)
    def save(s,name,keep_rels_fix=True):
        d=os.path.join(OUT,'_w_'+name); shutil.rmtree(d,ignore_errors=True); shutil.copytree(s.dir,d)
        # ลบคุณสมบัติซ้ำใน rPr/pPr (เช่น <w:sz/> 2 ครั้ง) ที่เกิดจากการแปลง .doc → .docx เพื่อให้ถูกตาม schema ของ Word
        for pr in s.tree.getroot().iter(q('rPr'), q('pPr')):
            seen=set()
            for ch in list(pr):
                if ch.tag in seen: pr.remove(ch)
                else: seen.add(ch.tag)
        xml=etree.tostring(s.tree,xml_declaration=True,encoding='UTF-8',standalone=True).decode('utf-8')
        xml=xml.replace(' xmlns:ns0="urn:slts"','').replace(' ns0:photoBlock="1"',' w14:paraId="5LT5F0T0"')
        # ตัด attribute namespace ที่ lxml สร้างขึ้น (กรณีใช้ prefix อื่น)
        xml=re.sub(r' xmlns:ns\d="urn:slts"','',xml); xml=re.sub(r' ns\d:photoBlock="1"',' w14:paraId="5LT5F0T0"',xml)
        open(os.path.join(d,'word/document.xml'),'w',encoding='utf-8').write(xml)
        if getattr(s,'extra_styles',None):
            sp=os.path.join(d,'word/styles.xml'); st=etree.parse(sp); sr=st.getroot()
            for el in s.extra_styles: sr.append(el)
            st.write(sp,xml_declaration=True,encoding='UTF-8',standalone=True)
        # ภาพตัวอย่าง (image3) แทนด้วย jpeg 1x1 เล็กๆ
        from PIL import Image
        im=Image.new('RGB',(4,3),'white'); im.save(os.path.join(d,'word/media/image3.jpeg'),'JPEG')
        out=os.path.join(OUT,name+'.docx')
        if os.path.exists(out): os.remove(out)
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            order=['[Content_Types].xml']
            for root,_,files in os.walk(d):
                for f in files:
                    full=os.path.join(root,f); arc=os.path.relpath(full,d)
                    if arc not in order: order.append(arc)
            for arc in order: z.write(os.path.join(d,arc),arc)
        shutil.rmtree(d)
        print('saved',out,os.path.getsize(out))

def common_p1_local(D,o):
    """ส่วนหัว/หน้า 1 ของแบบหมายศาล (ใช้ได้ทั้งแบบปกติและแบบประกาศ) o = offset ของย่อหน้า"""

# ---------------- 1) หมายศาล แบบปกติ (08b63021) ----------------
D=Doc('08b63021')
D.rep(3,'ย ขร๓๕','{{black_no}}',3)
D.rep(4,' ',' {{red_no}}')
D.rep(6,' ๑๕ เดือน ธันวาคม พ',' {{doc_d}} เดือน {{doc_m}} พ.ศ. {{doc_y}}',5)
D.rep(7,'อาญา','{{case_kind}}')
D.rep(12,'พนักงานอัยการจังหวัดอุดรธานี','{{plaintiff}}')
D.rep(21,'นายสุธีร์ ยันตบุตร','{{defendant}}')
D.rep(23,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(23,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(25,' ๑๑  ธันวาคม  ๒๕๖๘',' {{issue_date}}'); D.rep(25,'หมายนัด','{{summon_type}}')
D.rep(26,'นางสาวอังสุมาลิน  สุวรรณพจน์','{{recipient}}')
D.rep(27,'๓๐','{{house_no}}'); D.rep(27,'๗','{{moo}}')
D.rep(27,'  ','  {{soi}}',occ=2); D.rep(27,'  ','  {{road}}',occ=3)
D.rep(27,'บ้านตาด','{{subdistrict}}'); D.rep(27,'บ้านดุง','{{district}}')
D.rep(28,'อุดรธานี','{{province}}'); D.rep(28,'๔๑๑๙๐','{{postcode}}'); D.rep(28,'ส่งโดยเจ้าพนักงาน','{{send_method}}')
D.rep(29,'ส่งได้โดยวิธีปิดหมาย','{{result}}')
D.rep(30,'๑๓  ธันวาคม  ๒๕๖๘','{{serve_date}}'); D.rep(30,'นายเอกวิทย์  ลาดล้าย','{{server_name}}')
D.rep(31,'800','{{amount}}'); D.rep(31,'เงินงบประมาณ','{{pay_source}}')
D.rep(33,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.rep(35,'๑๘','{{rcpt_d}}'); D.rep(35,'ธันวาคม','{{rcpt_m}}'); D.rep(35,'๒๕๖๘','{{rcpt_y}}')
D.rep(36,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(36,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(38,'800','{{amount}}'); D.rep(38,'แปดร้อยบาทถ้วน','{{amount_text}}')
D.rep(42,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.sym(49,0,'cb_file'); D.sym(49,1,'cb_it'); D.sym(50,0,'cb_post'); D.sym(51,0,'cb_walk'); D.sym(51,1,'cb_sendto'); D.sym(52,0,'cb_court')
D.rep(51,'ส่งหมายไปที่','ส่งหมายไปที่ {{resend_to}}')
D.rep(52,'เห็นควรเสนอศาลเพื่อมีคำสั่ง','เห็นควรเสนอศาลเพื่อมีคำสั่ง {{court_note}}')
D.rep(54,'นายณัฐพงศ์  กุบแก้ว','{{inspector_name}}')
D.rep(55,'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ','{{inspector_position}}'); D.rep(55,' ปฏิบัติราชการแทน','{{inspector_acting}}')
D.rep(56,'ผู้อำนวยการ','{{inspector_title}}',4)
# หน้า 2
D.rep(64,'ย ขร๓๕','{{black_no}}',3); D.rep(65,' ',' {{red_no}}'); D.rep(67,'อาญา','{{case_kind}}')
D.rep(68,'๓๐','{{house_no}}'); D.rep(68,'๗','{{moo}}'); D.rep(68,'บ้านตาด','{{subdistrict}}')
D.rep(69,'บ้านดุง','{{district}}'); D.rep(69,'อุดรธานี','{{province}}')
D.rep(70,' ๑๓  ธันวาคม  ๒๕๖๘',' {{serve_date}}')
D.rep(71,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(71,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(72,'หมายนัด','{{summon_type}}'); D.rep(72,'นางสาวอังสุมาลิน  สุวรรณพจน์','{{recipient}}')
D.sym(74,0,'cb2_1'); D.sym(76,0,'cb2_2'); D.sym(77,0,'cb2_3'); D.sym(79,0,'cb2_4'); D.sym(80,0,'cb2_5')
D.rep(76,'นางสาวอังสุมาลิน  สุวรรณพจน์','{{recipient}}')
D.rep(77,'................  ','{{absent_name}}  ')
D.rep(80,'  ','  {{other_text}}',occ=1)
D.rep(84,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(85,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.photo(90)
D.payer_lines([43,44],46,42)
D.page_break_before(61)
D.save('local_normal')

# ---------------- 2) หมายศาล แบบปิดประกาศ (16d214ea) ----------------
D=Doc('16d214ea')
D.rep(3,'พ๔๒','{{black_no}}',3); D.rep(4,' ',' {{red_no}}')
D.rep(6,' ๑๕ เดือน มกราคม พ',' {{doc_d}} เดือน {{doc_m}} พ.ศ. {{doc_y}}',5)
D.rep(7,'แพ่ง','{{case_kind}}')
D.fill_empty(12,'{{plaintiff}}'); D.rep(16,'นางณัฐชพิมพ์ สีสร้อย','{{petitioner}}'); D.fill_empty(23,'{{defendant}}')
D.rep(25,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(25,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(27,' ๑๑  มกราคม  ๒๕๖๗',' {{issue_date}}'); D.rep(27,'ประกาศศาล','{{summon_type}}')
D.rep(28,'ที่ทำการผู้ใหญ่บ้าน','{{recipient}}')
D.rep(29,'ที่ทำการผู้ใหญ่บ้าน','{{house_no}}'); D.rep(29,'๕','{{moo}}')
D.rep(29,'  ','  {{soi}}',occ=2); D.rep(29,'  ','  {{road}}',occ=3)
D.rep(29,'หายโศก','{{subdistrict}}'); D.rep(29,'บ้านผือ','{{district}}')
D.rep(30,'อุดรธานี','{{province}}'); D.rep(30,'๔๑๑๖๐','{{postcode}}'); D.rep(30,'ส่งโดยเจ้าพนักงาน','{{send_method}}')
D.rep(31,'ส่งได้โดยวิธีปิดประกาศ','{{result}}')
D.rep(32,'๑๓  มกราคม  ๒๕๖๗','{{serve_date}}'); D.rep(32,'นายเอกวิทย์  ลาดล้าย','{{server_name}}')
D.rep(33,'๗๕๐','{{amount}}',3); D.rep(33,'ใบเสร็จเล่มที่ ๘๒๒๐๗ เลขที่ ๔๗๔','{{pay_source}}')
D.rep(35,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.rep(37,'๑๙','{{rcpt_d}}'); D.rep(37,'มกราคม','{{rcpt_m}}'); D.rep(37,'๒๕๖๗','{{rcpt_y}}')
D.rep(38,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(38,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(40,'๗๕๐','{{amount}}',3); D.rep(40,'เจ็ดร้อยห้าสิบบาทถ้วน','{{amount_text}}')
D.rep(44,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.sym(51,0,'cb_file'); D.sym(51,1,'cb_it'); D.sym(52,0,'cb_post'); D.sym(53,0,'cb_walk'); D.sym(53,1,'cb_sendto'); D.sym(54,0,'cb_court')
D.rep(53,'ส่งหมายไปที่','ส่งหมายไปที่ {{resend_to}}')
D.rep(54,'เห็นควรเสนอศาลเพื่อมีคำสั่ง','เห็นควรเสนอศาลเพื่อมีคำสั่ง {{court_note}}')
D.rep(56,'นายณัฐพงศ์  กุบแก้ว','{{inspector_name}}')
D.rep(57,'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ','{{inspector_position}}'); D.rep(57,' ปฏิบัติราชการแทน','{{inspector_acting}}')
D.rep(58,'ผู้อำนวยการ','{{inspector_title}}',4)
# หน้า 2 (บันทึกการปิดประกาศ)
D.rep(65,'พ๔๒','{{black_no2}}',3); D.rep(66,' ',' {{red_no2}}'); D.rep(68,'แพ่ง','{{case_kind}}')
D.fill_empty(73,'{{plaintiff}}'); D.rep(77,'นางณัฐชพิมพ์ สีสร้อย','{{petitioner}}'); D.fill_empty(83,'{{defendant}}')
D.rep(86,'๑๓  มกราคม  ๒๕๖๗','{{serve_date}}'); D.rep(86,'เวลากลางวัน','{{notice_time}}')
D.rep(88,'ที่ทำการผู้ใหญ่บ้าน','{{notice_place}}'); D.rep(88,'๕','{{moo}}')
D.rep(89,'หายโศก','{{subdistrict}}'); D.rep(89,'บ้านผือ','{{district}}'); D.rep(89,'อุดรธานี','{{province}}')
D.rep(93,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(94,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.photo(99)
D.payer_lines([45,46],48,44)
D.page_break_before(62)
D.save('local_notice')
NOTICE_DOC=D

# ---------------- 3) หมายต่างจังหวัด (ต.) แบบปกติ (b63ec711) ----------------
def t_page1(D):
    for pi in (2,3): D.rep(pi,'ต๑๙๙๔','{{t_no}}',3)
    D.rep(6,'ศาลจังหวัดขอนแก่น','{{origin_court}}')
    D.rep(7,'พ๗๗๗','{{black_no}}',3); D.rep(8,' ',' {{red_no}}')
    D.rep(10,' ๑๐ เดือน สิงหาคม พ',' {{doc_d}} เดือน {{doc_m}} พ.ศ. {{doc_y}}',5)
    D.rep(11,'แพ่ง','{{case_kind}}')
    D.rep(16,'ธนาคารกรุงไทย จำกัด ','{{plaintiff}}',5)
    D.rep(25,'-','{{defendant}}')
    D.rep(27,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(27,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
    D.rep(29,' ๓  สิงหาคม  ๒๕๖๙',' {{issue_date}}'); D.rep(29,'หมายนัดไต่สวนและสำเนาคำร้อง','{{summon_type}}')
    D.rep(30,'นางบุษกร  รัตนวงศ์  กรรมการบริษัท บุษกร ทรานสปอร์ต จำกัด','{{recipient}}')
    D.rep(30,'๖๐๒','{{house_no}}'); D.rep(30,'๑','{{moo}}')
    D.rep(31,' ',' {{soi}}'); D.rep(31,'  ','  {{road}}')
    D.rep(31,'บ้านเลื่อม','{{subdistrict}}'); D.rep(31,'เมืองอุดรธานี','{{district}}')
    D.rep(32,'อุดรธานี','{{province}}'); D.rep(32,'๔๑๐๐๐','{{postcode}}'); D.rep(32,'ส่งโดยเจ้าพนักงาน','{{send_method}}')
    D.rep(33,'ส่งได้โดยวิธีปิดหมาย','{{result}}')
    D.rep(34,' ๙  สิงหาคม  ๒๕๖๙',' {{serve_date}}'); D.rep(34,'นายเอกวิทย์  ลาดล้าย','{{server_name}}')
    D.rep(35,'๖๐๐','{{amount}}',3); D.rep(35,' ใบเสร็จเล่มที่ ๙๕๗๙๓ เลขที่ ๔๙',' {{pay_source}}')
    for pi in (38,43): D.rep(pi,'นายณัฐพงศ์  กุบแก้ว','{{inspector_name}}')
    for pi in (39,44): D.rep(pi,'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ','{{inspector_position}}')
    D.rep(46,' ใบเสร็จเล่มที่ ๙๕๗๙๓ เลขที่ ๔๙',' {{receipt_ref}}')
    D.rep(49,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
    D.rep(51,'๑๔','{{rcpt_d}}'); D.rep(51,'สิงหาคม','{{rcpt_m}}'); D.rep(51,'๒๕๖๙','{{rcpt_y}}')
    D.rep(52,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(52,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
    D.rep(53,'๙  สิงหาคม  ๒๕๖๙','{{serve_date}}'); D.rep(53,'หมายนัดไต่สวนและสำเนาคำร้อง','{{summon_type}}')
    D.rep(54,'นางบุษกร  รัตนวงศ์  กรรมการบริษัท บุษกร ทรานสปอร์ต จำกัด','{{recipient}}')
    D.rep(54,'ศาลจังหวัดขอนแก่น','{{pay_source2}}')
    D.rep(54,'๖๐๐','{{amount}}',3); D.rep(54,'หกร้อยบาทถ้วน','{{amount_text}}')
    D.rep(59,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
    D.rep(65,'304.019','304.019/{{letter_no}}',2); D.rep(65,'ลงวันที่','ลงวันที่ {{letter_date}}')
    D.rep(66,'ศาลจังหวัดขอนแก่น','{{origin_court}}')
    D.rep(67,'ที่ ศย๓๐๔','{{ref_no}}',5)
    D.rep(75,'นายณัฐพงศ์  กุบแก้ว','{{inspector_name}}')
    D.rep(78,'เจ้าพนักงานศาลยุติธรรมชำนาญการพิเศษ','{{inspector_position}}'); D.rep(78,' ปฏิบัติราชการแทน','{{inspector_acting}}')
    D.rep(81,'ผู้อำนวยการ','{{inspector_title}}',4)
    D.payer_lines([60,61],63,59)

D=Doc('b63ec711')
t_page1(D)
for pi in (90,91): D.rep(pi,'ต๑๙๙๔','{{t_no}}',3)
D.rep(93,'พ๗๗๗','{{black_no}}',3); D.rep(94,' ',' {{red_no}}'); D.rep(96,'แพ่ง','{{case_kind}}')
D.rep(97,'๖๐๒','{{house_no}}'); D.rep(97,'๑','{{moo}}'); D.rep(97,'บ้านเลื่อม','{{subdistrict}}')
D.rep(98,'เมืองอุดรธานี','{{district}}'); D.rep(98,'อุดรธานี','{{province}}')
D.rep(99,' ๙  สิงหาคม  ๒๕๖๙',' {{serve_date}}')
D.rep(100,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(100,'นักวิชาการคอมพิวเตอร์ปฏิบัติการ','{{reporter_position}}')
D.rep(101,'หมายนัดไต่สวนและสำเนาคำร้อง','{{summon_type}}'); D.rep(101,'  ','  {{recipient}}',occ=0)
D.sym(103,0,'cb2_1'); D.sym(105,0,'cb2_2'); D.sym(106,0,'cb2_3'); D.sym(108,0,'cb2_4'); D.sym(109,0,'cb2_5')
D.rep(105,'นางบุษกร  รัตนวงศ์  กรรมการบริษัท บุษกร ทรานสปอร์ต จำกัด','{{recipient}}')
D.rep(106,'................  ','{{absent_name}}  ')
D.rep(109,'อื่นๆ','อื่นๆ  {{other_text}}')
D.rep(113,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); D.rep(114,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
D.photo(118)
D.page_break_before(86)
D.save('t_normal')

# ---------------- 4) หมาย ต. แบบปิดประกาศ = หน้า 1 ของ ต. + หน้า 2 ของแบบประกาศ ----------------
D=Doc('b63ec711')
t_page1(D)
N=Doc('16d214ea')
N.rep(65,'พ๔๒','{{black_no2}}',3); N.rep(66,' ',' {{red_no2}}'); N.rep(68,'แพ่ง','{{case_kind}}')
N.fill_empty(73,'{{plaintiff}}'); N.rep(77,'นางณัฐชพิมพ์ สีสร้อย','{{petitioner}}'); N.fill_empty(83,'{{defendant}}')
N.rep(86,'๑๓  มกราคม  ๒๕๖๗','{{serve_date}}'); N.rep(86,'เวลากลางวัน','{{notice_time}}')
N.rep(88,'ที่ทำการผู้ใหญ่บ้าน','{{notice_place}}'); N.rep(88,'๕','{{moo}}')
N.rep(89,'หายโศก','{{subdistrict}}'); N.rep(89,'บ้านผือ','{{district}}'); N.rep(89,'อุดรธานี','{{province}}')
N.rep(93,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); N.rep(94,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
N.photo(99)
# ตัดหน้า 2 ของ ต. ออก แล้วนำหน้า 2 ของแบบประกาศมาต่อ
body=D.tree.getroot().find('w:body',ns); nbody=N.tree.getroot().find('w:body',ns)
start=D.ps[86]
while start.getparent() is not body: start=start.getparent()
kids=list(body); si=kids.index(start)
for k in kids[si:]:
    if k.tag!=q('sectPr'): body.remove(k)
sect=body.find('w:sectPr',ns)
nstart=N.ps[62]
while nstart.getparent() is not nbody: nstart=nstart.getparent()
nk=list(nbody); ni=nk.index(nstart)
# ย้ายเฉพาะส่วนที่มีเนื้อหา: ตัดย่อหน้าว่างก่อนหัวเรื่อง
nstyles=etree.parse(os.path.join(N.dir,'word/styles.xml')).getroot()
sty={st.get(q('styleId')):st for st in nstyles.findall('w:style',ns)}
D.extra_styles=[]; remap={}
def need(sid):
    if sid in remap or sid not in sty: return
    nid='N'+sid; remap[sid]=nid
    el=copy.deepcopy(sty[sid]); el.set(q('styleId'),nid)
    nm=el.find('w:name',ns)
    if nm is not None: nm.set(q('val'),'N '+nm.get(q('val')))
    for ref in el.iter(q('basedOn'),q('next'),q('link')):
        v=ref.get(q('val')); need(v); ref.set(q('val'),remap.get(v,v))
    D.extra_styles.append(el)
for k in nk[ni:]:
    if k.tag==q('sectPr'): continue
    c=copy.deepcopy(k)
    for ref in c.iter(q('pStyle'),q('rStyle'),q('tblStyle')):
        v=ref.get(q('val'))
        if v=='Normal': continue
        need(v); ref.set(q('val'),remap.get(v,v))
    sect.addprevious(c)
print('remapped styles',remap)
D.ps=list(D.tree.getroot().iter(q('p')))
# หน้า 2 ใช้ระยะขอบของแบบประกาศ (หมายศาล): แบ่ง section — หน้า 1 คงระยะขอบแบบ ต.
t_sect=copy.deepcopy(sect)
n_sect=copy.deepcopy(nbody.find('w:sectPr',ns))
for i,p in enumerate(D.ps):
    if ''.join(p.itertext()).strip()=='บันทึกการปิดประกาศ':
        D.page_break_before(i)   # ลบย่อหน้าว่างก่อนหัวเรื่อง
        ppr=p.find('w:pPr',ns); pb=ppr.find('w:pageBreakBefore',ns); ppr.remove(pb)
        brk=etree.Element(q('p')); bppr=etree.SubElement(brk,q('pPr'))
        typ=t_sect.find('w:type',ns)
        if typ is None: typ=etree.Element(q('type')); t_sect.insert(0,typ)
        typ.set(q('val'),'nextPage')
        bppr.append(t_sect)
        # ย่อหน้าตัด section ให้เล็กที่สุด ไม่ให้ดันหน้า 1 ล้น
        rpr=etree.SubElement(bppr,q('rPr')); sz=etree.SubElement(rpr,q('sz')); sz.set(q('val'),'2')
        sp=etree.Element(q('spacing')); sp.set(q('before'),'0'); sp.set(q('after'),'0'); sp.set(q('line'),'20'); sp.set(q('lineRule'),'exact')
        bppr.insert(0,sp)
        top=p
        while top.getparent() is not body: top=top.getparent()
        top.addprevious(brk)
        break
body.replace(sect,n_sect)
# เลข id ของ drawing ต้องไม่ซ้ำ
used=0
for e in D.tree.getroot().iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr'):
    if e.get('id','').isdigit(): used+=1; e.set('id',str(100+used))
D.save('t_notice')

# ---------------- 4b) ทางเลือก: ใช้ไฟล์แบบประกาศเป็นฐาน แล้วแทนหน้า 1 ด้วยหน้า 1 ของแบบ ต. ----------------
if True:  # แบบที่ใช้จริง (ฐานจากแบบประกาศ เพื่อคงรูปวงเล็บ/เส้นของหน้า 2)
    T=Doc('b63ec711'); t_page1(T)
    N=Doc('16d214ea')
    N.rep(65,'พ๔๒','{{black_no2}}',3); N.rep(66,' ',' {{red_no2}}'); N.rep(68,'แพ่ง','{{case_kind}}')
    N.fill_empty(73,'{{plaintiff}}'); N.rep(77,'นางณัฐชพิมพ์ สีสร้อย','{{petitioner}}'); N.fill_empty(83,'{{defendant}}')
    N.rep(86,'๑๓  มกราคม  ๒๕๖๗','{{serve_date}}'); N.rep(86,'เวลากลางวัน','{{notice_time}}')
    N.rep(88,'ที่ทำการผู้ใหญ่บ้าน','{{notice_place}}'); N.rep(88,'๕','{{moo}}')
    N.rep(89,'หายโศก','{{subdistrict}}'); N.rep(89,'บ้านผือ','{{district}}'); N.rep(89,'อุดรธานี','{{province}}')
    N.rep(93,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}'); N.rep(94,'นายเอกวิทย์  ลาดล้าย','{{reporter_name}}')
    N.photo(99)
    nbody=N.tree.getroot().find('w:body',ns); tbody=T.tree.getroot().find('w:body',ns)
    h=N.ps[62]
    while h.getparent() is not nbody: h=h.getparent()
    # ลบหน้า 1 ของแบบประกาศ
    for k in list(nbody):
        if k is h: break
        nbody.remove(k)
    # นำหน้า 1 ของ ต. (ถึงก่อน "บันทึกการปิดหมาย") มาไว้ข้างหน้า + ตัด section
    th=T.ps[86]
    while th.getparent() is not tbody: th=th.getparent()
    first=[]
    for k in list(tbody):
        if k is th: break
        first.append(k)
    while first and first[-1].tag==q('p') and not ''.join(first[-1].itertext()).strip() and first[-1].find('.//w:drawing',ns) is None: first.pop()
    for k in first: h.addprevious(copy.deepcopy(k))
    t_sect=copy.deepcopy(tbody.find('w:sectPr',ns))
    typ=t_sect.find('w:type',ns)
    if typ is None: typ=etree.Element(q('type')); t_sect.insert(0,typ)
    typ.set(q('val'),'nextPage')
    brk=etree.Element(q('p')); bppr=etree.SubElement(brk,q('pPr'))
    sp=etree.SubElement(bppr,q('spacing')); sp.set(q('before'),'0'); sp.set(q('after'),'0'); sp.set(q('line'),'20'); sp.set(q('lineRule'),'exact')
    bppr.append(t_sect)
    h.addprevious(brk)
    # หาย่อหน้าว่างระหว่าง brk กับหัวเรื่อง
    N.ps=list(N.tree.getroot().iter(q('p')))
    n=0
    for e in N.tree.getroot().iter('{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}docPr'):
        n+=1; e.set('id',str(200+n)) if e.get('id','').isdigit() else None
    N.save('t_notice')
