#!/usr/bin/env python3
"""Build four academic DOCX reports from actual СПЕКТР experiment data.

Run from any directory with python-docx and Pillow available. PDFs are produced
from these DOCX files by render_docx.py, not independently typeset copies.
"""
from pathlib import Path
from collections import Counter
import json
import hashlib
import math
import re
import statistics as st
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports'
ASSETS = OUT / 'assets'
OUT.mkdir(exist_ok=True)
ASSETS.mkdir(exist_ok=True)
META = json.loads((ROOT / 'report-metadata.json').read_text())
DATA = json.loads((ROOT / 'results/reliability/experiment.json').read_text())
MANIFEST = json.loads((ROOT / 'results/manifest.json').read_text())
ROWS = DATA['rows']
TEST_COUNT = int(re.search(r'\btests\s+(\d+)', (ROOT / 'results/test-output.txt').read_text()).group(1))
SHA = hashlib.sha256((ROOT / 'dist/engine.js').read_bytes()).hexdigest()
assert SHA == MANIFEST['hashes']['dist/engine.js'], 'Engine changed: rerun experiments and capture_evidence first'
assert len(ROWS) == 800 and {r['seed'] for r in ROWS} == set(range(1, 21))

FONTFILE = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
if not FONTFILE.exists():
    FONTFILE = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
FONT = lambda size: ImageFont.truetype(str(FONTFILE), size)

def selected(**filters):
    return [row for row in ROWS if all(row.get(key) == value for key, value in filters.items())]

def avg(rows, key): return st.mean(row[key] for row in rows)
def fmt(value, digits=2): return f'{value:.{digits}f}'.replace('.', ',')
def mean_sd(rows, key, digits=2):
    values = [row[key] for row in rows]
    return f'{fmt(st.mean(values), digits)} ± {fmt(st.stdev(values), digits)}'

def group(allocation='central', negotiation=False, scenario='normal', protection=True):
    return selected(allocation=allocation, negotiation=negotiation, scenario=scenario, protection=protection)

def paired(a, b, key):
    aa = {row['seed']: row[key] for row in a}
    bb = {row['seed']: row[key] for row in b}
    values = [bb[seed] - aa[seed] for seed in sorted(aa.keys() & bb.keys())]
    return st.mean(values), sum(x > 1e-8 for x in values), sum(x < -1e-8 for x in values), sum(abs(x) <= 1e-8 for x in values)

def trace(name): return json.loads((ROOT / f'results/traces/{name}.json').read_text())

def wrap(draw, text, font, width):
    lines = []
    for para in text.split('\n'):
        line = ''
        for word in para.split():
            test = f'{line} {word}'.strip()
            if line and draw.textlength(test, font=font) > width:
                lines.append(line); line = word
            else: line = test
        lines.append(line)
    return lines

def box(draw, rect, text, size=30, fill='#f5f5f5'):
    draw.rounded_rectangle(rect, radius=15, fill=fill, outline='#444444', width=3)
    font = FONT(size); lines = wrap(draw, text, font, rect[2] - rect[0] - 26)
    height = len(lines) * (size + 8)
    y = (rect[1] + rect[3] - height) / 2
    for line in lines:
        draw.text(((rect[0] + rect[2] - draw.textlength(line, font=font)) / 2, y), line, font=font, fill='black')
        y += size + 8

def arrow(draw, start, end, label=None, offset=(0, 0)):
    draw.line([start, end], fill='#333333', width=4)
    angle = math.atan2(end[1]-start[1], end[0]-start[0])
    a = (end[0]-18*math.cos(angle-.42), end[1]-18*math.sin(angle-.42))
    b = (end[0]-18*math.cos(angle+.42), end[1]-18*math.sin(angle+.42))
    draw.polygon([end, a, b], fill='#333333')
    if label:
        font=FONT(28)
        cx=(start[0]+end[0])/2+offset[0]; cy=(start[1]+end[1])/2+offset[1]
        w=draw.textlength(label,font=font)
        draw.rectangle((cx-w/2-8,cy-4,cx+w/2+8,cy+29),fill='white')
        draw.text((cx-w/2,cy),label,font=font,fill='black')

def diagrams():
    im=Image.new('RGB',(1600,620),'white'); d=ImageDraw.Draw(im)
    box(d,(570,15,1030,130),'Многоагентная лаборатория',32)
    roles=[((20,245,310,440),'3 научные группы\nСобственные планы и бюджеты'),
           ((335,245,625,440),'3 установки\nОчереди и исполнение'),
           ((650,245,940,440),'2 робота\nПеревозка контейнеров'),
           ((965,245,1255,440),'Диспетчер\nЦентральные назначения'),
           ((1280,245,1570,440),'Контроль качества\nПроверки и восстановление')]
    for rect,text in roles:
        arrow(d,(800,130),((rect[0]+rect[2])/2,245)); box(d,rect,text,28)
    d.text((30,515),'Среда: часы смены, 24 задачи, местоположения и факты выполнения',font=FONT(30),fill='black')
    im.save(ASSETS/'roles.png')
    im=Image.new('RGB',(1600,720),'white'); d=ImageDraw.Draw(im)
    rects={'g':(20,250,350,435),'e':(640,25,970,205),'r':(640,485,970,665),'c':(640,250,970,435),'q':(1250,250,1580,435)}
    arrow(d,(350,290),(640,130),'CFP AWARD',offset=(0,-28))
    arrow(d,(640,175),(350,325),'BID ACK',offset=(0,8))
    arrow(d,(350,365),(640,535),'перевозка',offset=(0,-28))
    arrow(d,(350,345),(640,345),'REQUEST',offset=(0,-30))
    arrow(d,(805,250),(805,205),'ASSIGN',offset=(105,-10))
    arrow(d,(805,435),(805,485),'задание',offset=(105,-10))
    arrow(d,(970,115),(1250,290),'результат',offset=(10,-30))
    arrow(d,(970,575),(1250,390),'доставка',offset=(10,5))
    arrow(d,(1250,345),(970,345),'проверки',offset=(0,-30))
    for key,text in [('g','Научные группы\nOFFER COUNTER\nACCEPT REJECT'),('e','Установки\nСлоты и измерения'),('r','Роботы\nСтатусы доставки'),('c','Координатор\nЦентральный режим'),('q','Контроль качества\nРезультаты и lease')]: box(d,rects[key],text,28)
    im.save(ASSETS/'communications.png')

def chart(path, panels, width=1600, height=710):
    """Publication plot: each panel has title, labels, means, SD and ylabel."""
    im=Image.new('RGB',(width,height),'white'); d=ImageDraw.Draw(im)
    count=len(panels); panel_w=width/count
    for j,panel in enumerate(panels):
        title,labels,values,errors,ylabel=panel
        left=j*panel_w+100; right=(j+1)*panel_w-35; top=100; bottom=height-150
        d.text((left,20),title,font=FONT(32),fill='black')
        maximum=max(v+(errors[i] if errors else 0) for i,v in enumerate(values))*1.16 or 1
        for k in range(5):
            y=bottom-(bottom-top)*k/4
            d.line((left,y,right,y),fill='#dddddd',width=2)
            label=f'{maximum*k/4:.0f}' if maximum>5 else f'{maximum*k/4:.2f}'
            d.text((left-15-d.textlength(label,font=FONT(28)),y-13),label,font=FONT(28),fill='black')
        d.line((left,top,left,bottom),fill='black',width=2); d.line((left,bottom,right,bottom),fill='black',width=2)
        step=(right-left)/len(values); bar=step*.5
        for i,value in enumerate(values):
            cx=left+step*(i+.5); y=bottom-(bottom-top)*value/maximum
            fill=['#477b78','#9ebbb9','#596c86','#abb7c9'][i%4]
            d.rectangle((cx-bar/2,y,cx+bar/2,bottom),fill=fill,outline='black',width=1)
            err=(errors[i] if errors else 0)*(bottom-top)/maximum
            d.line((cx,y-err,cx,y+err),fill='black',width=3)
            d.line((cx-9,y-err,cx+9,y-err),fill='black',width=3)
            d.line((cx-9,y+err,cx+9,y+err),fill='black',width=3)
            text=f'{value:.2f}' if maximum<300 else f'{value:.1f}'
            d.text((cx-d.textlength(text,font=FONT(28))/2,y-err-34),text,font=FONT(28),fill='black')
            for n,line in enumerate(labels[i].split('\n')):
                d.text((cx-d.textlength(line,font=FONT(28))/2,bottom+15+n*33),line,font=FONT(28),fill='black')
        d.text((left,bottom+105),ylabel,font=FONT(28),fill='black')
    im.save(path)

def set_cell(cell, text, bold=False, align=WD_ALIGN_PARAGRAPH.LEFT, fill=None):
    cell.text=str(text); cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for p in cell.paragraphs:
        p.alignment=align; p.paragraph_format.first_line_indent=Cm(0)
        p.paragraph_format.space_after=Pt(2); p.paragraph_format.space_before=Pt(2); p.paragraph_format.line_spacing=1.08
        for run in p.runs: run.font.size=Pt(10.5); run.font.bold=bold
    tcPr=cell._tc.get_or_add_tcPr()
    mar=OxmlElement('w:tcMar')
    for edge in ['top','left','bottom','right']:
        node=OxmlElement(f'w:{edge}'); node.set(qn('w:w'),'90'); node.set(qn('w:type'),'dxa'); mar.append(node)
    tcPr.append(mar)
    if fill:
        shd=OxmlElement('w:shd'); shd.set(qn('w:fill'),fill); tcPr.append(shd)

def table(doc, headers, rows, widths=None):
    t=doc.add_table(rows=1,cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    for i,h in enumerate(headers): set_cell(t.rows[0].cells[i],h,True,fill='E7E7E7')
    repeat=OxmlElement('w:tblHeader'); t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in rows:
        cells=t.add_row().cells
        for i,value in enumerate(row): set_cell(cells[i],value,align=WD_ALIGN_PARAGRAPH.LEFT if i==0 else WD_ALIGN_PARAGRAPH.CENTER)
    borders=OxmlElement('w:tblBorders')
    for edge in ['top','left','bottom','right','insideH','insideV']:
        e=OxmlElement(f'w:{edge}'); e.set(qn('w:val'),'single'); e.set(qn('w:sz'),'4'); e.set(qn('w:color'),'D9D9D9'); borders.append(e)
    t._tbl.tblPr.append(borders)
    if widths:
        for row in t.rows:
            for cell,w in zip(row.cells,widths): cell.width=Cm(w)
    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(2); p.paragraph_format.space_before=Pt(0); p.paragraph_format.line_spacing=.4; p.add_run().font.size=Pt(2)
    return t

def p(doc,text,bold=False):
    para=doc.add_paragraph(text)
    if bold:
        for r in para.runs:r.bold=True
    return para

def h(doc,text): doc.add_heading(text,level=1)
def page(doc): doc.add_page_break()
def picture(doc,name,caption,width=16):
    para=doc.add_paragraph(); para.alignment=WD_ALIGN_PARAGRAPH.CENTER; para.paragraph_format.first_line_indent=Cm(0)
    para.paragraph_format.keep_with_next=True
    inline=para.add_run().add_picture(str(ASSETS/name),width=Cm(width))
    inline._inline.docPr.set('descr',caption)
    cap=doc.add_paragraph(caption); cap.alignment=WD_ALIGN_PARAGRAPH.CENTER; cap.paragraph_format.first_line_indent=Cm(0)
    cap.paragraph_format.space_after=Pt(7); cap.paragraph_format.line_spacing=1.0
    for r in cap.runs:r.font.size=Pt(11)

def start(num,title):
    doc=Document(); sec=doc.sections[0]
    sec.page_width=Cm(21); sec.page_height=Cm(29.7); sec.top_margin=Cm(2); sec.bottom_margin=Cm(2); sec.left_margin=Cm(3); sec.right_margin=Cm(1.5)
    sec.header_distance=Cm(.8); sec.footer_distance=Cm(.8); sec.different_first_page_header_footer=True
    normal=doc.styles['Normal']; normal.font.name='Times New Roman'; normal.font.size=Pt(14); normal.font.color.rgb=RGBColor(0,0,0)
    normal.paragraph_format.line_spacing=1.3; normal.paragraph_format.space_after=Pt(5); normal.paragraph_format.first_line_indent=Cm(1.25); normal.paragraph_format.alignment=WD_ALIGN_PARAGRAPH.JUSTIFY
    for name,size in [('Title',17),('Heading 1',14),('Heading 2',14)]:
        style=doc.styles[name]; style.font.name='Times New Roman'; style.font.size=Pt(size); style.font.color.rgb=RGBColor(0,0,0); style.font.bold=True
        style.paragraph_format.first_line_indent=Cm(0); style.paragraph_format.space_before=Pt(8); style.paragraph_format.space_after=Pt(7)
    # Materialize blank first-page stories so LibreOffice does not inherit PAGE.
    sec.first_page_footer.paragraphs[0].text=''
    sec.first_page_header.paragraphs[0].text=''
    footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER; footer.paragraph_format.first_line_indent=Cm(0)
    field=OxmlElement('w:fldSimple'); field.set(qn('w:instr'),'PAGE'); footer._p.append(field)
    header=sec.header.paragraphs[0]; header.text=f'СПЕКТР   Лабораторная работа {num}'; header.paragraph_format.first_line_indent=Cm(0); header.paragraph_format.alignment=WD_ALIGN_PARAGRAPH.RIGHT
    for r in header.runs:r.font.size=Pt(10);r.font.color.rgb=RGBColor(0,0,0)
    cp=doc.core_properties; cp.title=f'Лабораторная работа {num} {title}'; cp.author=META['author']; cp.subject=META['discipline']; cp.keywords='СПЕКТР многоагентная система лабораторная работа'; cp.comments=''
    cover=doc.add_paragraph(META['university']); cover.alignment=WD_ALIGN_PARAGRAPH.CENTER; cover.paragraph_format.first_line_indent=Cm(0); cover.paragraph_format.space_after=Pt(24)
    for r in cover.runs:r.bold=True;r.font.size=Pt(16)
    q=doc.add_paragraph('Отчет по дисциплине\n'+META['discipline']); q.alignment=WD_ALIGN_PARAGRAPH.CENTER; q.paragraph_format.first_line_indent=Cm(0); q.paragraph_format.space_after=Pt(52)
    q=doc.add_paragraph(f'Лабораторная работа {num}',style='Title'); q.alignment=WD_ALIGN_PARAGRAPH.CENTER
    q=doc.add_paragraph(title,style='Title'); q.alignment=WD_ALIGN_PARAGRAPH.CENTER; q.paragraph_format.space_after=Pt(22)
    q=doc.add_paragraph('Многоагентная система управления\nисследовательской лабораторией СПЕКТР');q.alignment=WD_ALIGN_PARAGRAPH.CENTER;q.paragraph_format.first_line_indent=Cm(0);q.paragraph_format.space_after=Pt(50)
    for text in [f'Выполнил: {META["author"]}',f'Группа: {META["group"]}',f'Преподаватель: {META["teacher"]}']:
        q=doc.add_paragraph(text);q.alignment=WD_ALIGN_PARAGRAPH.RIGHT;q.paragraph_format.first_line_indent=Cm(0);q.paragraph_format.space_after=Pt(5)
    q=doc.add_paragraph(f'{META["city"]}\n{META["year"]}');q.alignment=WD_ALIGN_PARAGRAPH.CENTER;q.paragraph_format.first_line_indent=Cm(0);q.paragraph_format.space_before=Pt(48)
    page(doc);return doc

def sources(doc):
    h(doc,'Источники и приложения')
    for text in [
        '1. Рекомендации по выполнению лабораторных работ по курсу «Теория многоагентных систем». Файл Лабораторные-МАС.pdf, 2 с.',
        '2. СПЕКТР, версия 1.0.0: dist/engine.js, dist/app.js, tests/engine.test.mjs. Исходники предоставлены отдельно.',
        '3. Данные: results/reliability/runs.csv, summary.csv, experiment.json. Трассы: results/traces. Версии и SHA256: results/manifest.json.',
    ]:
        para=p(doc,text);para.paragraph_format.line_spacing=1.05;para.paragraph_format.space_after=Pt(3);para.paragraph_format.first_line_indent=Cm(0)
        for run in para.runs:run.font.size=Pt(11)

def save(doc,num):
    # The bundled default DOCX contains a blue Title border; strip it explicitly.
    for root in [doc.styles.element,doc.element]:
        for node in list(root.iter(qn('w:pBdr'))):node.getparent().remove(node)
    path=OUT/f'ЛР{num}_Холодков_СПЕКТР.docx';doc.save(path);print(path)

def report1():
    doc=start(1,'Спецификация и архитектурное проектирование многоагентной системы')
    h(doc,'1 Цель и постановка задачи')
    p(doc,'В работе я спроектировал и реализовал многоагентную систему СПЕКТР для управления исследованиями в вымышленной ядерной лаборатории. Модель позволяет сравнивать распределение задач, наблюдать переговоры групп и проверять устойчивость к недостоверным сообщениям. Реализация не моделирует ядерные процессы: все ресурсы, контейнеры и длительности условные.')
    p(doc,'За смену длительностью 180 тактов три научные группы публикуют 24 заявки, по восемь на группу. Заявка задает время появления, совместимые установки, длительность, дедлайн и ценность. Для начала исследования робот должен доставить контейнер к назначенной установке. Три установки и два робота создают дефицит ресурсов.')
    h(doc,'2 Формальная спецификация')
    p(doc,'Систему я задаю кортежем M = (A, T, R, S, Msg, δ, U, C). A содержит 10 агентов: три группы, три установки, двух роботов, координатора и контроль качества. T содержит 24 задачи; R задает оборудование, транспорт и кредиты групп; S хранит состояния; Msg задает типы сообщений; δ определяет переходы; U содержит полезности; C задает ограничения.')
    p(doc,'Задача t описывается полями id, group, release, compatible, duration, deadline, value и status. Восемь задач каждой группы появляются постепенно. Начальная нагрузка полностью определяется seed до начала выбора алгоритма, что позволяет проводить парные сравнения.')
    table(doc,['Объект','Количество','Ограничение'],[['Научные группы','3','По 8 задач и 80 кредитов'],['Установки','3','Одна активная работа на установку'],['Роботы','2','Одна перевозка на робота'],['Очередь установки','До 4 броней','Проверка при новом назначении']],[5.0,2.2,9.0])
    page(doc)
    h(doc,'3 Роли и связи агентов')
    p(doc,'Научные группы управляют собственными планами, установки объявляют доступность и обслуживают очереди, роботы выполняют перевозки. В центральном режиме назначения делает диспетчер; в контрактном режиме заявки и предложения формируют сами участники. Контроль качества проверяет программные обязательства и результаты.')
    picture(doc,'roles.png','Рисунок 1 - Диаграмма ролей многоагентной системы')
    picture(doc,'communications.png','Рисунок 2 - Граф коммуникаций и основные типы сообщений')
    p(doc,'Обмен реализован внутри одного процесса явными типизированными сообщениями. Агентам не нужен внешний AI API: решения задаются программными правилами, локальными оценками и состояниями.')
    page(doc)
    h(doc,'4 Цели знания и полномочия')
    p(doc,'Группа «Изотоп» получает более ценные длительные заявки, «Импульс» - более короткие сроки, «Контур» - плановые исследования. Группы видят собственные заявки и бюджет, а также полученные предложения. Они могут запрашивать ресурс, выбирать предложение и обменивать очередность за кредиты. Изменить фактический результат измерения эти полномочия не позволяют.')
    p(doc,'Агент установки знает свою очередь, текущую работу и доступность. Он может предложить время завершения, подтвердить бронь и выполнять одну работу. Робот знает позицию и назначенную перевозку; маршрут проходит по условному коридору. Его действие меняет положение контейнера в среде. Координатор использует объявленные заявки и состояния ресурсов.')
    p(doc,'Полезность группы равна сумме ценностей корректных результатов: за опоздание начисляется 35% ценности, дополнительно вычитается 0,18 за такт ожидания от release до последнего старта. К результату добавляется изменение кредитного баланса. В общей полезности переводы между группами взаимно сокращаются.')
    h(doc,'5 Состояния и правила взаимодействия')
    p(doc,'Основной путь задачи: pending → reserved → transport → queued → running → verifying → completed. При отклонении ошибочного измерения задача возвращается в queued для повторного исполнения; при отказе перевозчика защита возвращает ее в reserved. Проверка результата занимает два такта в защищенном режиме.')
    p(doc,'Для контрактной сети явно заданы CFP, BID, AWARD и ACK. Отдельные переговоры используют OFFER, COUNTER, ACCEPT и REJECT. Согласие двух групп меняет позиции соседних задач в очереди и переносит кредиты. Без согласия очередь сохраняется. Сообщения получают последовательный id, такт, отправителя, адресата, тип и текст.')
    page(doc)
    h(doc,'6 Обоснование архитектуры и проверка реализации')
    p(doc,'Я выбрал дискретную традиционную МАС с общими часами среды. Такое устройство позволяет отделить факты выполнения от сообщений участников, воспроизводить порядок событий и наблюдать индивидуальные решения. Локальные интересы групп создают конфликт за слоты, поэтому система подходит для исследования переговоров, а ограниченные очереди и проверки сообщений - для испытаний надежности.')
    p(doc,'Программа реализована на JavaScript без внешних библиотек. Движок выполняется в браузере и Node.js; интерфейс показывает план лаборатории, перевозки, задачи, очереди и журнал. Скорость анимации меняет только темп просмотра. Снимки состояния копируются, поэтому интерфейс не может незаметно изменить внутреннее состояние движка.')
    p(doc,f'Для проверки я выполнил {TEST_COUNT} автоматических тестов. Они проверяют воспроизводимость, ресурсные инварианты, явные протоколы, реальные сделки, повторы сообщений, ложные завершения, бронь-призрак, недостоверный прибор, отказ робота и полноту трассы. Все {TEST_COUNT} тестов завершились успешно. Дополнительно проведено 800 экспериментальных смен на seed от 1 до 20.')
    h(doc,'7 Выводы и границы применения')
    p(doc,'Полученная архитектура обеспечивает все четыре исследования: два механизма распределения, независимое включение переговоров, ввод программных нарушений и сравнение защиты. Ее автономность определяется собственным состоянием и правилами агентов. Контроль качества использует истинное состояние учебной среды, поэтому его обнаружение ошибок идеализировано. Сетевая задержка, процессорные затраты и физика измерений не моделируются.')
    sources(doc);save(doc,1)

def report2():
    doc=start(2,'Исследование механизмов распределения задач и координации')
    central=group();contract=group('contract')
    du,win,lose,tie=paired(central,contract,'utility')
    h(doc,'1 Цель и условия сравнения')
    p(doc,f'В работе я сравнил центральное распределение и контрактную сеть на одинаковых нагрузках СПЕКТР. В штатном режиме без переговоров центральный механизм дал в среднем {fmt(avg(central,"validCompleted"))} корректного исследования, контрактный - {fmt(avg(contract,"validCompleted"))}. Различие относится к реализованным правилам назначения и транспорта при горизонте 180 тактов.')
    p(doc,'Для основного сравнения я отключил переговоры, включил защиту и выбрал сценарий normal. На каждом seed оба механизма получили один и тот же исходный набор из 24 заявок. Использовано 20 seed от 1 до 20; всего в основном сравнении 40 прогонов. Другие сочетания сохранены в общей факторной серии для проверки взаимодействия с переговорами.')
    table(doc,['Параметр','Значение'],[['Горизонт смены','180 условных тактов'],['Нагрузка','24 задачи, 3 группы'],['Ресурсы','3 установки и 2 робота'],['Seed','1-20, парное сравнение'],['Защита','Включена; проверка 2 такта'],['Переговоры в основном сравнении','Выключены']],[7.0,9.0])
    h(doc,'2 Центральное распределение')
    p(doc,'Координатор сортирует готовые заявки по ближайшему дедлайну, затем по ценности и идентификатору. За такт рассматриваются до двух заявок. Из совместимых доступных установок выбирается вариант с минимальной прогнозируемой датой завершения. Очередь ограничивает новые брони. Перевозки выбираются по времени назначения, затем по сроку задачи.')
    page(doc)
    h(doc,'3 Контрактная сеть и стоимость координации')
    p(doc,'В контрактном режиме каждая группа раз в три такта выбирает собственную заявку по сочетанию value/duration и срочности. Порядок групп циклически меняется. Группа посылает CFP совместимым установкам; они формируют BID с оценкой завершения. После выбора минимальной оценки следуют AWARD и ACK. Роботы выбирают перевозку по оценке собственного пути, затем по дедлайну.')
    p(doc,'Таким образом, сравниваются конкретные реализации с различными локальными правилами и частотой решений. Оно не изолирует только сетевую топологию и не доказывает превосходство централизованных архитектур в общем случае. Перевозка и ожидание контейнера в голове очереди могут существенно менять результат.')
    h(doc,'4 Показатели эксперимента')
    p(doc,'Я учитывал уникальные корректные завершения, полезность, сообщения, ожидание, загрузку и опоздания. Число сообщений служит условной стоимостью координации; процессорное время и объем сетевого трафика не измеряются. Ожидание считается от появления заявки до последнего старта среди запускавшихся задач.')
    table(doc,['Показатель','Центральный','Контрактный'],[[label,mean_sd(central,key,dec),mean_sd(contract,key,dec)] for label,key,dec in [('Корректные завершения','validCompleted',2),('Полезность','utility',2),('Сообщения','messages',2),('Ожидание тактов','meanWait',2),('Загрузка доля','utilization',3),('Просроченные результаты','late',2)]],[6.4,4.9,4.9])
    p(doc,'В таблице приведены среднее и выборочное стандартное отклонение по 20 нагрузкам. Опоздания считаются среди корректно завершенных задач, поэтому их число следует читать вместе с количеством завершений.')
    page(doc)
    h(doc,'5 Результаты и объяснение различий')
    picture(doc,'allocation.png','Рисунок 1 - Штатный режим без переговоров Средние и стандартные отклонения')
    p(doc,f'Средняя парная разность полезности «контрактный минус центральный» составила {fmt(du)}. Контрактный вариант оказался выше на {win} seed, ниже на {lose}, равен на {tie}. Среднее число корректных завершений различается на {fmt(avg(contract,"validCompleted")-avg(central,"validCompleted"))} задачи. Эти парные результаты подтверждают преимущество выбранного центрального правила на данной серии, а не только разницу двух отдельных средних.')
    p(doc,f'Среднее число сообщений составило {fmt(avg(central,"messages"))} и {fmt(avg(contract,"messages"))}. Контрактный протокол содержит больше типов сообщений, но центральный механизм повторно запрашивает назначения при дефиците очереди; поэтому фактическая разница определяется всей трассой. Среднее ожидание равно {fmt(avg(central,"meanWait"))} и {fmt(avg(contract,"meanWait"))} такта соответственно.')
    p(doc,'Центральное правило непосредственно учитывает дедлайн, а контрактное допускает приоритет локально выгодной заявки. Резервирование места до прибытия контейнера создает блокирование головы очереди. Прогноз завершения учитывает текущую очередь, но не все будущие задержки транспорта. Это объясняет возможность менее удачного общего расписания при допустимых локальных решениях.')
    page(doc)
    h(doc,'6 Воспроизводимость и ограничения')
    p(doc,'Исследование выполнено на Node.js '+MANIFEST['node']+'. Движок и генератор данных не используют внешние API. Исходная нагрузка определяется seed до выполнения алгоритма. Я сохранил индивидуальные строки, сводные значения и две полные трассы normal-central-no-negotiation и normal-contract-no-negotiation на seed 1.')
    p(doc,'Для повторения серии используется команда node experiments.mjs --seeds 20 --scenario all --compare-protection --out results/reliability. Основное сравнение выбирается по scenario=normal, protection=true, negotiation=false. Полная серия содержит 800 прогонов; контрольная сумма движка записана в manifest.json.')
    p(doc,'Полезность включает 35% ценности просроченной задачи и штраф 0,18 за такт ожидания. Выбор этих весов влияет на выводы. Горизонт 180 тактов ограничивает завершение поздних работ; его увеличение может уменьшить разницу. Данные получены для одной семьи нагрузок из 24 заявок, без реальных сетевых задержек.')
    h(doc,'7 Выводы')
    p(doc,'На исследованной штатной нагрузке я получил более высокие значения доли завершённых исследований и суммарной полезности у центрального механизма. Контрактная сеть обеспечивает явный обмен предложениями и локальный выбор, но данный вариант требует изменения критериев и учета транспорта для улучшения результата. Выбор механизма следует проверять вместе с политикой очереди и конкретным характером задач. Эффект дополнительных переговоров исследован отдельно в работе 3.')
    sources(doc);save(doc,2)

def report3():
    doc=start(3,'Проектирование механизма переговоров и разрешения конфликтов')
    h(doc,'1 Цель и модель конфликта')
    p(doc,'В работе я реализовал двусторонние переговоры об обмене соседними местами в очереди установки. Исследуемый конфликт возникает, когда задача одной группы рискует опоздать, а более ранний слот принадлежит другой группе. Уступка уменьшает ожидание покупателя, но задерживает продавца, поэтому простой выбор лучшего предложения установки не разрешает конфликт интересов.')
    p(doc,'Каждая группа начинает со 80 условных кредитов. Кредиты переносятся между группами и учитываются в их индивидуальной полезности. В суммарной полезности они сокращаются, поэтому сама передача денег не повышает общий результат. Принятая сделка действительно меняет очередь; отказ сохраняет ее порядок.')
    h(doc,'2 Протокол переговоров')
    p(doc,'Раз в семь тактов установка рассматривает соседние заявки разных групп. Повторный запрос одной задачи ограничен интервалом 18 тактов. Покупатель оценивает выигрыш от сокращения ожидания и возможного сохранения полной ценности задачи. В сообщении OFFER он предлагает 35% ожидаемого выигрыша, округляя вниз, но не менее одного кредита.')
    p(doc,'Продавец оценивает дополнительное ожидание и возможный штраф за опоздание. В COUNTER он требует округленную вверх стоимость потери плюс один кредит. Покупатель отвечает ACCEPT, если цена не превышает собственную выгоду и текущий бюджет; иначе отправляет REJECT. На установку допускается один переговорный эпизод за раунд.')
    table(doc,['Элемент','Правило'],[['Выгода покупателя','0,18 × сэкономленное ожидание + избежанный штраф срока'],['Потери продавца','0,18 × задержка + новый штраф срока'],['Согласие','Цена ≤ выгода и цена ≤ бюджет'],['Действие сделки','Перестановка двух задач и перевод кредитов']],[5.2,11.0])
    page(doc)
    h(doc,'3 Фактический эпизод переговоров')
    tr=trace('normal-protected'); msgs=tr['messages']; accept=next(m for m in msgs if m['type']=='ACCEPT'); index=msgs.index(accept)
    episode=msgs[max(0,index-2):index+1]
    p(doc,f'Я рассмотрел трассу штатной защищенной смены на seed 1. На такте {accept["tick"]} зафиксирован следующий обмен. Сообщения ниже взяты из экспорта, а не составлены как предполагаемый пример.')
    for m in episode:p(doc,f'{m["type"]}, {m["from"]} → {m["to"]}: {m["text"]}')
    swap=next(e for e in tr['events'] if e['type']=='SLOT_SWAP')
    p(doc,f'Событие SLOT_SWAP подтверждает изменение: на установке {swap["equipment"]} задача {swap["task"]} перемещена перед {swap["displaced"]}; группа {swap["buyer"]} перечислила группе {swap["seller"]} {swap["credits"]} кредитов. Таким образом, журнал содержит предложение, встречное условие, принятие и изменение состояния.')
    p(doc,'Сделка рациональна относительно локальных прогнозов, но эти прогнозы не учитывают все будущие перевозки и заявки. Поэтому согласие двух участников не гарантирует улучшение всей смены. Некоторые предложения отклоняются из-за слишком высокой цены или недостатка бюджета.')
    h(doc,'4 План исследования')
    p(doc,'Я сравнил включенные и выключенные переговоры отдельно для central и contract. Остальные условия фиксированы: normal, защита включена, 180 тактов, seed 1-20. Это четыре варианта и 80 прогонов. Справедливость оценивал индексом Джейна по долям корректно выполненных восьми задач каждой группы; при отсутствии выполненных задач индекс равен нулю.')
    page(doc)
    h(doc,'5 Экспериментальные результаты')
    records=[]
    for a,name in [('central','Центральный'),('contract','Контрактный')]:
        for n in [False,True]:
            rs=group(a,n);records.append([name+(' с' if n else ' без'),fmt(avg(rs,'validCompleted')),fmt(avg(rs,'utility')),fmt(avg(rs,'fairness'),4),fmt(avg(rs,'messages'))])
    table(doc,['Режим и переговоры','Корректно','Полезность','Справедливость','Сообщения'],records,[4.7,2.7,2.9,3.3,2.6])
    picture(doc,'negotiation.png','Рисунок 1 - Изменение полезности и числа завершений при переговорах')
    for a,name in [('central','центральном'),('contract','контрактном')]:
        off,on=group(a,False),group(a,True);delta,w,l,t=paired(off,on,'utility')
        p(doc,f'В {name} режиме средняя парная разность полезности «с переговорами минус без» равна {fmt(delta)}. Улучшение наблюдалось на {w} seed, ухудшение на {l}, равенство на {t}. Изменение корректных завершений: {fmt(avg(on,"validCompleted")-avg(off,"validCompleted"))}.')
    page(doc)
    h(doc,'6 Эффективность справедливость и ограничения')
    p(doc,'В контрактном режиме переговоры повысили полезность и число корректных завершений; в центральном ухудшили оба показателя. Локальные сделки могут нарушать удачное расписание, а перемещение вперед недоставленной задачи усиливает блокирование очереди.')
    cc,kk=group('central',True),group('contract',True)
    p(doc,f'В центральном режиме среднее число переговорных эпизодов составило {fmt(avg(cc,"negotiations"))}, сделок - {fmt(avg(cc,"negotiationAccepted"))}; в контрактном - {fmt(avg(kk,"negotiations"))} и {fmt(avg(kk,"negotiationAccepted"))}. Сообщения увеличивают стоимость координации. Число нарушений во всех этих защищенных штатных прогонах равно нулю.')
    p(doc,'Индекс Джейна близок к единице из-за небольших различий в выполнении равных планов. Он не учитывает ценность исследований и должен оцениваться вместе с результативностью. Бюджеты ограничивают покупку приоритета, поэтому переговоры не гарантируют справедливости.')
    h(doc,'7 Выводы')
    p(doc,'Я реализовал предложения, встречные условия, согласие и отказ с изменением очереди и балансов. Эксперимент показал, что механизм помогает одной политике распределения и мешает другой. Для развития следует учитывать готовность контейнера и общий эффект перестановки, а затем повторить парные эксперименты.')
    sources(doc);save(doc,3)

def report4():
    doc=start(4,'Диверсионный анализ и оценка надежности многоагентной системы')
    h(doc,'1 Цель и модель нарушений')
    p(doc,'В работе я проверил, как СПЕКТР реагирует на недостоверный прибор, фиктивную бронь, повтор результата и ложное завершение. Воздействия реализованы как программные события учебной среды. Они не описывают способы воздействия на реальные ядерные объекты. Цель исследования - выявить ошибочные переходы состояния и проверить восстановление после нарушения обязательств.')
    p(doc,'Нарушитель может отправить ложное или повторное сообщение либо удержать слот без доставки. Сбой прибора делает результаты недостоверными в истинном состоянии модели. Без защитных проверок система доверяет части таких сообщений. Контроль качества использует факты учебной среды, поэтому качество обнаружения является идеализированным.')
    table(doc,['Сценарий','Такт','Проблема и защита'],[['device','35','Недостоверный И-02; проверка, повтор, диагностика 12 тактов'],['ghost','35','Бронь без контейнера; истечение lease через 8 тактов'],['duplicate','55','Повтор RESULT; уникальность идентификатора операции'],['misreport','35','Ложное завершение; проверка действительного выполнения'],['robot вручную','По вводу','Нет heartbeat; переназначение через 5 тактов']],[3.3,1.8,11.1])
    h(doc,'2 План эксперимента')
    p(doc,'Я выполнил полный план: 20 seed × 5 сценариев × 2 распределения × 2 состояния переговоров × 2 состояния защиты = 800 прогонов. normal включен как контроль. Основные таблицы этой работы выделяют central с переговорами, чтобы не смешивать действие защиты с выбором координации. Полные данные всех сочетаний приложены отдельно.')
    page(doc)
    h(doc,'3 Правила защиты и проверяемые свойства')
    p(doc,'Идемпотентность обеспечивается учетом идентификатора RESULT для задачи: повтор не должен увеличивать число зачтенных результатов. Ложное завершение отклоняется, если нет допустимого состояния verifying или сообщения о фактическом выполнении. В модели истинное выполнение доступно проверяющему агенту непосредственно.')
    p(doc,'Просроченная фиктивная бронь удаляется из очереди. Повторные ручные брони ограничены одной активной бронью на установку, поэтому старые lease не теряются. При отказе робота после пяти тактов без heartbeat его незавершенная перевозка возвращается на назначение. Эти правила уменьшают зависание ресурсов.')
    p(doc,'При выявлении недостоверного результата контроль качества отправляет исследование на повтор, снимает ошибку прибора и вводит 12 тактов недоступности на диагностику. Проверка результата сама занимает два такта. Без защиты эта задержка отсутствует, поэтому сравнение отражает как предотвращенные ошибки, так и цену проверки.')
    h(doc,'4 Результаты защищенных и незащищенных прогонов')
    records=[]
    for scenario,name in [('normal','Штатный'),('device','Прибор'),('ghost','Бронь'),('duplicate','Повтор'),('misreport','Ложный итог')]:
        for guard in [False,True]:
            rs=group('central',True,scenario,guard)
            records.append([name,'вкл' if guard else 'выкл',fmt(avg(rs,'validCompleted')),fmt(avg(rs,'undetected')),fmt(avg(rs,'recoveries'))])
    table(doc,['Сценарий','Защита','Корректно','Необнаружено','Восстановления'],records,[4.0,2.0,3.1,3.5,3.6])
    page(doc)
    h(doc,'5 Анализ устойчивости')
    p(doc,'В таблице показаны средние по 20 seed. «Необнаружено» включает принятые недостоверные результаты и повторы. Счетчик принятых сообщений completed не используется как главный критерий надежности.')
    picture(doc,'reliability.png','Рисунок 1 - Корректные результаты и необнаруженные ошибки central с переговорами')
    device0=group('central',True,'device',False);device1=group('central',True,'device',True)
    p(doc,f'В сценарии недостоверного прибора защита повысила число корректных результатов с {fmt(avg(device0,"validCompleted"))} до {fmt(avg(device1,"validCompleted"))}, а необнаруженные ошибки уменьшились с {fmt(avg(device0,"undetected"))} до {fmt(avg(device1,"undetected"))}. При этом полезность снизилась с {fmt(avg(device0,"utility"))} до {fmt(avg(device1,"utility"))}: повторные работы и диагностика увеличили ожидание.')
    p(doc,'Такое сочетание не является противоречием. Полезность содержит штраф ожидания только по корректным завершенным задачам; дополнительные поздние результаты могут вносить малый или отрицательный вклад. Поэтому для надежности я отдельно рассматриваю достоверность, завершение и стоимость проверок. Одной суммарной оценки недостаточно.')
    ghost0=group('central',True,'ghost',False);ghost1=group('central',True,'ghost',True)
    p(doc,f'Для фиктивной брони число корректных результатов выросло с {fmt(avg(ghost0,"validCompleted"))} до {fmt(avg(ghost1,"validCompleted"))}. При повторах и ложном завершении защищенные прогоны не содержали необнаруженных ошибочных зачетов. Эти результаты относятся к заданной модели сообщений и одному плановому воздействию на смену.')
    page(doc)
    h(doc,'6 Разбор трассы и функциональные проверки')
    tr=trace('device-protected');events=tr['events']; fault=next(e for e in events if e['type']=='FAULT_INJECTED');reject=next(e for e in events if e['type']=='QUALITY_REJECT')
    p(doc,f'В трассе device-protected на seed 1 сбой введен на такте {fault["tick"]}; на такте {reject["tick"]} контроль отклонил результат задачи {reject["task"]}. После этого зафиксированы повторная очередь и диагностический простой установки. Финальные показатели этой смены: {tr["finalState"]["metrics"]["validCompleted"]} корректных исследований, {tr["finalState"]["metrics"]["undetected"]} необнаруженных ошибок.')
    un=trace('device-unprotected')['finalState']['metrics']
    p(doc,f'При том же seed без защиты принято {un["completed"]} сообщений результатов, но корректных уникальных исследований только {un["validCompleted"]}; необнаруженных ошибок {un["undetected"]}. Разница показывает, почему доверие к собственному отчету агента не заменяет проверку состояния.')
    p(doc,f'Все {TEST_COUNT} автоматических тестов завершились успешно. В каждом такте проверялись единственность активного назначения и перевозки, допустимые состояния и отсутствие дублирования задач в ресурсах. Отдельные тесты охватывают ручной отказ робота и повторные фиктивные брони; эти воздействия не входят в пять плановых сценариев основной таблицы.')
    h(doc,'7 Выводы и остаточные ограничения')
    p(doc,'В пределах заданных сценариев защита предотвращает ошибочные зачеты и уменьшает зависание очередей. Она требует времени на проверки и повторные работы, поэтому не гарантирует максимум полезности. Следующий шаг - моделирование несовершенного обнаружения, задержек сообщений и нескольких одновременных нарушений. Полученные результаты не являются оценкой безопасности реального оборудования.')
    sources(doc);save(doc,4)

def main():
    diagrams()
    c,k=group(),group('contract')
    chart(ASSETS/'allocation.png',[
        ('Полезность',['Центр','Контракт'],[avg(c,'utility'),avg(k,'utility')],[st.stdev(r['utility'] for r in c),st.stdev(r['utility'] for r in k)],'20 нагрузок, среднее ± SD'),
        ('Число сообщений',['Центр','Контракт'],[avg(c,'messages'),avg(k,'messages')],[st.stdev(r['messages'] for r in c),st.stdev(r['messages'] for r in k)],'Переговоры выключены')])
    combos=[group('central',False),group('central',True),group('contract',False),group('contract',True)]
    labels=['Центр\nбез','Центр\nс','Контракт\nбез','Контракт\nс']
    chart(ASSETS/'negotiation.png',[(title,labels,[avg(g,key) for g in combos],[st.stdev(r[key] for r in g) for g in combos],'«с» и «без» переговоров; среднее ± SD') for title,key in [('Полезность','utility'),('Корректные завершения','validCompleted')]])
    scenarios=['device','ghost','duplicate','misreport'];labels=['Прибор\nвыкл','Прибор\nвкл','Бронь\nвыкл','Бронь\nвкл']
    pairs=[group('central',True,s,g) for s in scenarios[:2] for g in [False,True]]
    errors=[0]*4
    chart(ASSETS/'reliability.png',[
        ('Корректные завершения',labels,[avg(g,'validCompleted') for g in pairs],[st.stdev(r['validCompleted'] for r in g) for g in pairs],'Защита выключена и включена; ± SD'),
        ('Необнаруженные ошибки',['Прибор','Бронь','Повтор','Ложный'],[avg(group('central',True,s,False),'undetected') for s in scenarios],errors,'Без защиты; с защитой везде 0')])
    report1();report2();report3();report4()
    (OUT/'report-build.json').write_text(json.dumps({'engineSHA256':SHA,'sourceRows':len(ROWS),'seeds':list(range(1,21)),'date':META['date'],'documents':[f'ЛР{i}_Холодков_СПЕКТР.docx' for i in range(1,5)]},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
