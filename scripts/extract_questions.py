"""Extract supplied PDFs; no inferred or generated answer keys. pip install pypdf"""
import json, re, sys, hashlib
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError:
    cache = Path.home() / 'AppData/Local/uv/cache/archive-v0'
    candidates = list(cache.glob('*/pypdf/_reader.py'))
    if not candidates:
        raise
    sys.path.insert(0, str(candidates[0].parent.parent))
    from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src' / 'questions.json'


def clean(s):
    return re.sub(r'\s+', ' ', s).strip()


def normalize_answer(s):
    return clean(s).replace('Ο', 'O')


def canonical_name(name):
    name = name.replace('(답안포함)', '').replace('(답안)', '')
    return re.sub(r'\((\d+회)\s+답안포함\)', r'(\1)', name)


def read_pages(file):
    pages = []
    for page in PdfReader(str(file)).pages:
        text = page.extract_text() or ''
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        # Some generated PDFs expose every glyph as a separate text line in
        # plain mode. Layout mode reconstructs the visible words and lines.
        if lines and sum(len(line) == 1 for line in lines) / len(lines) > 0.6:
            text = page.extract_text(extraction_mode='layout') or text
        text = re.sub(r'NCS 수변전설비공사 \d+회차 종합 모의고사\s*\|', '', text)
        text = re.sub(r'(?m)^\s*\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}.*$', '', text)
        text = re.sub(r'(?m)^\s*file:///.*?\s+\d+/\d+\s*$', '', text)
        pages.append(text)
    return pages


def answer_details(full):
    sourced = list(re.finditer(r'문\s*(\d+)\.\s*정답\s*:\s*(.*?)\s*\[출처\s*:\s*(.*?)\]', full, re.S))
    if sourced:
        return [(m, int(m[1]), clean(m[2]), clean(m[3])) for m in sourced]

    # Some combined PDFs contain complete per-question explanations without
    # bracketed source labels. Their answer headings still delimit each block.
    plain = list(re.finditer(r'(?m)^문\s*(\d+)\.\s*정답\s*:\s*([^\r\n]+?)[ \t\xa0]*$', full))
    return [(m, int(m[1]), clean(m[2]), None) for m in plain]


old = json.loads(OUTPUT.read_text(encoding='utf-8')) if OUTPUT.exists() else {'books': [], 'questions': []}
old_ids = {canonical_name(b['file']): b['id'] for b in old.get('books', [])}
legacy_ids = {
    '(과평)배관배선+조명+전열 예상문제1.pdf': 'book-1',
    '(과평)배관배선+조명+전열 예상문제2.pdf': 'book-2',
    '(과평)배관배선+조명+전열 예상문제3.pdf': 'book-3',
    '(과평)접지피뢰설비공사+수변전설비공사+개폐장치 유지보수공사 예상문제3.pdf': 'book-4',
}

source_files = sorted((ROOT / 'data').rglob('*.pdf'))
selected = {}
for file in source_files:
    key = canonical_name(file.name)
    if '(답안)' in file.stem:
        current = selected.get(key)
        if current is None or '(답안)' in current.stem:
            selected[key] = file
    else:
        selected[key] = file

questions = []
books = []
seen_books = set()

for file in sorted(selected.values(), key=lambda p: str(p)):
    canonical = canonical_name(file.name)
    if canonical in seen_books:
        continue
    seen_books.add(canonical)

    book_id = legacy_ids.get(canonical) or old_ids.get(canonical)
    if not book_id:
        book_id = 'book-' + hashlib.sha256(canonical.encode()).hexdigest()[:12]

    pages = read_pages(file)
    body = '\n'.join(pages)
    if '제2부. 정답' in body:
        body = body.split('제2부. 정답', 1)[0]
    body = re.sub(r'(?m)^\s*■?\s*제[123]과목\s*:[^\n]*', '', body)
    matches = list(re.finditer(r'문\s*(\d+)\.', body))
    if not matches:
        continue

    answer_file = file if '(답안)' in file.stem else file.with_name(file.stem + '(답안).pdf') if file.with_name(file.stem + '(답안).pdf').exists() else file
    answers, explanations, references, answer_pages, conflicts = {}, {}, {}, {}, {}

    if answer_file.exists():
        a_pages = read_pages(answer_file)
        full = '\n'.join(a_pages)
        if '제2부. 정답' in full:
            table = full.split('제2부. 정답', 1)[1].split('문항별 상세 해설', 1)[0]
            token = r'(?:[OΟX]\s*\((?:참|거짓)\)|[①②③④]|부싱\s*\(Bushing\)|리듀서\s*\(Reducer\)|[ㄱ-ㅎ](?:\s*,\s*[ㄱ-ㅎ])+|방폭형 콘센트)'
            for m in re.finditer(r'문\s*(\d+)\s+(' + token + ')', table):
                number = int(m[1])
                answers[number] = normalize_answer(m[2])
                answer_pages[number] = next((i + 1 for i, t in enumerate(a_pages) if re.search(r'문\s*' + str(number) + r'\s+' + token, t)), answer_pages.get(number))
            details = answer_details(full)
            for i, (m, n, detailed_answer, reference) in enumerate(details):
                detailed_answer = normalize_answer(detailed_answer)
                detail = clean(full[m.end():details[i + 1][0].start() if i + 1 < len(details) else len(full)])
                if n in answers and re.fullmatch(r'[①②③④]|[OX]\s*\((?:참|거짓)\)', answers[n]) and answers[n] != detailed_answer:
                    conflicts[n] = f'원본 답안 불일치: 빠른 정답표 {answers[n]}, 상세 해설 {detailed_answer}. 확인 전 자동 채점에서 제외합니다.'
                answers[n] = detailed_answer
                if reference:
                    references[n] = reference
                answer_pages[n] = next((i + 1 for i, t in enumerate(a_pages) if re.search(rf'문\s*{n}\.\s*정답', t)), answer_pages.get(n))
                if i + 1 < len(details) or detail.endswith(('.', '!', '?', ')')):
                    explanations[n] = detail

        if not answers and answer_file.name.endswith('(답안).pdf') and '접지' in answer_file.name:
            scanned = json.loads((ROOT / 'scripts' / 'scanned-answers.json').read_text(encoding='utf-8'))
            if scanned['file'] != answer_file.name or scanned['sha256'] != hashlib.sha256(answer_file.read_bytes()).hexdigest():
                raise ValueError(f'Scanned answer PDF changed; review transcription before importing: {answer_file.name}')
            for item in scanned['questions']:
                n = item['number']
                answers[n] = item['answer']
                explanations[n] = item['explanation']
                references[n] = item['reference']
                answer_pages[n] = item['page']

    # keep known manual corrections from previous corpus
    if file.name == '(과평)배관배선+조명+전열 예상문제2(답안포함).pdf' and 14 in conflicts:
        answers[14] = '③'
        conflicts[14] = '사용자 확인으로 정답 ③을 반영했습니다. 원본 상세 해설에는 ④로 표기되어 있습니다.'

    if file.name == '(과평)배관배선+조명+전열 예상문제2(답안포함).pdf':
        answers[14] = '③'

    for n in list(conflicts):
        if n in answers and answers[n] == '③' and conflicts[n].startswith('원본 답안 불일치'):
            answers[n] = '③'

    title = canonical.replace('(과평)', '').replace('+', ' · ').replace('예상문제', ' 예상문제 ')
    books.append({
        'id': book_id,
        'title': title,
        'file': file.name,
        'count': len(matches),
        'hasAnswers': bool(answers),
        'note': f'정답 {sum(a is not None for a in answers.values())}문항 · 해설 {len(explanations)}문항'
    })

    for i, m in enumerate(matches):
        n = int(m[1])
        raw = body[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(body)]
        tag = re.search(r'\[(?:[^/\]]+\s*/\s*)?학\s*습(?:\s*[\d,\s]+)?\s*:\s*([^\]]+)\]', raw)
        topic = clean(tag[1]) if tag else '전기설비'
        if tag:
            raw = raw[:tag.start()] + raw[tag.end():]
        question_type = 'ox' if re.search(r'선택\s*:', raw) else 'choice' if '①' in raw else 'short'
        raw = re.sub(r'선택\s*:\s*\(\s*[OΟ]\s*/\s*X\s*\)|답(?:란|안)?\s*:\s*(?:\([^)]*\)|_+)', '', raw)
        raw = re.sub(r'\s*_+(?:\s*,?\s*\(\d+\)\s*_+)*\s*$', '', raw)
        parts = re.split(r'[①②③④]', raw) if question_type == 'choice' else [raw]
        page = next((p + 1 for p, t in enumerate(pages) if re.search(rf'문\s*{n}\.', t)), 1)
        q = {
            'id': f'{book_id}-q{n:02}',
            'bookId': book_id,
            'number': n,
            'type': question_type,
            'topic': topic,
            'prompt': clean(parts[0]),
            'options': [clean(x) for x in parts[1:]],
            'answer': answers.get(n),
            'answerNote': conflicts.get(n),
            'explanation': explanations.get(n),
            'reference': references.get(n),
            'sourceFile': file.name,
            'page': page,
            'answerSourceFile': answer_file.name if answers else None,
            'answerPage': answer_pages.get(n),
            'explanationNote': None if n in explanations else ('답안 PDF에서 이 문항의 완전한 상세 해설을 확인할 수 없습니다.' if answers else '정답 미등록 문항입니다.')
        }
        if question_type == 'choice':
            q['options'] = [clean(opt) for opt in q['options'] if opt.strip()]
        questions.append(q)

OUTPUT.write_text(json.dumps({'books': books, 'questions': questions}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Extracted {len(questions)} questions; {len(books)} books')
