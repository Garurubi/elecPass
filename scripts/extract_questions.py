"""Extract supplied PDFs; no inferred or generated answer keys. pip install pypdf"""
import json, re, sys, hashlib
from pathlib import Path
try:
    from pypdf import PdfReader
except ImportError:
    cache = Path.home() / 'AppData/Local/uv/cache/archive-v0'
    candidates = list(cache.glob('*/pypdf/_reader.py'))
    if not candidates: raise
    sys.path.insert(0, str(candidates[0].parent.parent))
    from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
def clean(s):
    return re.sub(r'\s+', ' ', s).strip()

output = ROOT / 'src/questions.json'
old = json.loads(output.read_text(encoding='utf-8')) if output.exists() else {'books': []}
def canonical_name(name):
    return name.replace('(답안포함)', '').replace('(답안)', '')

old_ids = {canonical_name(b['file']): b['id'] for b in old['books']}

questions, books = [], []
confirmed_answers = {
    ('(과평)배관배선+조명+전열 예상문제2(답안포함).pdf', 14): '③',
}
def read_pages(file):
    return [re.sub(r'NCS 수변전설비공사 \d+회차 종합 모의고사\s*\|', '', p.extract_text() or '') for p in PdfReader(file).pages]

source_files = sorted((ROOT / 'data').glob('*.pdf'))
seen_books = set()
for file in source_files:
    if '(답안)' in file.stem:
        continue
    legacy_ids = {'(과평)배관배선+조명+전열 예상문제1.pdf':'book-1', '(과평)배관배선+조명+전열 예상문제2.pdf':'book-2', '(과평)배관배선+조명+전열 예상문제3.pdf':'book-3', '(과평)접지피뢰설비공사+수변전설비공사+개폐장치 유지보수공사 예상문제3.pdf':'book-4'}
    canonical = canonical_name(file.name)
    assert canonical not in seen_books, f'Duplicate question sources: {canonical}'
    seen_books.add(canonical)
    book_id = legacy_ids.get(canonical) or old_ids.get(canonical)
    if not book_id:
        import hashlib
        book_id = 'book-' + hashlib.sha256(canonical.encode()).hexdigest()[:12]
    pages = read_pages(file)
    body = '\n'.join(pages).split('제2부. 정답', 1)[0]
    body = re.sub(r'(?m)^\s*■?\s*제[123]과목\s*:[^\n]*', '', body)
    matches = list(re.finditer(r'문\s*(\d+)\.', body))
    assert [int(m[1]) for m in matches] == list(range(1, len(matches)+1))
    answer_file = file if '(답안포함)' in file.stem else file.with_name(file.stem + '(답안).pdf')
    answers, explanations, references, answer_pages, conflicts = {}, {}, {}, {}, {}
    if answer_file.exists() and not any(t.strip() for t in read_pages(answer_file)):
        scanned = json.loads((ROOT/'scripts/scanned-answers.json').read_text(encoding='utf-8'))
        assert scanned['file']==answer_file.name and scanned['sha256']==hashlib.sha256(answer_file.read_bytes()).hexdigest(), 'Scan changed: review transcription before importing'
        for item in scanned['questions']:
            n=item['number'];answers[n]=item['answer'];explanations[n]=item['explanation'];references[n]=item['reference'];answer_pages[n]=item['page']
    elif answer_file.exists():
        ap = read_pages(answer_file)
        full = '\n'.join(ap)
        assert '제2부. 정답' in full, 'Unknown answer PDF format'
        table = full.split('제2부. 정답', 1)[1].split('문항별 상세 해설', 1)[0]
        # Cells contain a bounded answer token, followed by another cell or commentary.
        token = r'(?:[OX]\s*\((?:참|거짓)\)|[①②③④]|부싱\s*\(Bushing\)|리듀서\s*\(Reducer\)|[ㄱ-ㅎ](?:\s*,\s*[ㄱ-ㅎ])+|방폭형 콘센트)'
        for m in re.finditer(r'문\s*(\d+)\s+(' + token + ')', table):
            number = int(m[1])
            assert number not in answers, ('Duplicate answer', number)
            answers[number] = clean(m[2])
            answer_pages[number] = next(i+1 for i,t in enumerate(ap) if re.search(r'문\s*'+str(number)+r'\s+'+token,t))
        am = list(re.finditer(r'문\s*(\d+)\.\s*정답\s*:\s*(.*?)\s*\[출처\s*:\s*(.*?)\]', full, re.S))
        for i,m in enumerate(am):
            n = int(m[1]); detail = clean(full[m.end():am[i+1].start() if i+1<len(am) else len(full)])
            detailed_answer = clean(m[2])
            if n in answers and re.fullmatch(r'[①②③④]|[OX]\s*\((?:참|거짓)\)', answers[n]) and answers[n] != detailed_answer:
                conflicts[n] = f'원본 답안 불일치: 빠른 정답표 {answers[n]}, 상세 해설 {detailed_answer}. 확인 전 자동 채점에서 제외합니다.'
            answers[n] = detailed_answer
            answer_pages[n] = next(i+1 for i,t in enumerate(ap) if re.search(rf'문\s*{n}\.\s*정답',t))
            references[n] = clean(m[3])
            # A final explanation without sentence punctuation is visibly truncated.
            if i+1<len(am) or detail.endswith(('.', '!', '?', ')')):
                explanations[n] = detail
        assert set(answers) == {int(m[1]) for m in matches}, 'Answer key does not cover all questions'
    for n in conflicts:
        correction = confirmed_answers.get((file.name, n))
        if correction is not None:
            answers[n] = correction
            conflicts[n] = f'사용자 확인으로 정답 {correction}을 반영했습니다. 원본 상세 해설에는 ④로 표기되어 있습니다.'
        else:
            answers[n] = None
    assert not answer_file.exists() or set(answers) == {int(m[1]) for m in matches}, 'Incomplete answer mapping'
    title = Path(canonical).stem.replace('(과평)', '').replace('+', ' · ').replace('예상문제', ' 예상문제 ')
    corrected_count = sum((file.name, n) in confirmed_answers for n in conflicts)
    books.append({'id':book_id,'title':title,'file':file.name,'count':len(matches),'hasAnswers':bool(answers),'note':f'정답 {sum(a is not None for a in answers.values())}문항 · 해설 {len(explanations)}문항' + (f' · 사용자 확인 반영 {corrected_count}문항' if corrected_count else (f' · 답안 확인 필요 {len(conflicts)}문항' if conflicts else ''))})
    for i,m in enumerate(matches):
        n=int(m[1]); raw=body[m.end():matches[i+1].start() if i+1<len(matches) else len(body)]
        tag=re.search(r'\[학\s*습\s*[\d,\s]+:\s*([^\]]+)\]', raw) or re.search(r'^\s*\[([^\]]+)\]',raw)
        topic=clean(tag[1]) if tag else '전기설비'
        if tag: raw=raw[:tag.start()]+raw[tag.end():]
        question_type = 'ox' if re.search(r'선택\s*:',raw) else 'choice' if '①' in raw else 'short'
        raw=re.sub(r'선택\s*:\s*\(\s*O\s*/\s*X\s*\)|답(?:란|안)?\s*:\s*(?:\([^)]*\)|_+)', '', raw)
        parts=re.split(r'[①②③④]',raw) if question_type=='choice' else [raw]
        page=next(p+1 for p,t in enumerate(pages) if re.search(rf'문\s*{n}\.',t))
        q={'id':f'{book_id}-q{n:02}','bookId':book_id,'number':n,'type':question_type,'topic':topic,'prompt':clean(parts[0]),'options':[clean(x) for x in parts[1:]],'answer':answers.get(n),'answerNote':conflicts.get(n),'explanation':explanations.get(n),'reference':references.get(n),'sourceFile':file.name,'page':page,'answerSourceFile':answer_file.name if answers else None,'answerPage':answer_pages.get(n),'explanationNote':None if n in explanations else ('답안 PDF에서 이 문항의 완전한 상세 해설을 확인할 수 없습니다.' if answers else '정답 미등록 문항입니다.')}
        if question_type=='choice': assert len(q['options'])==4, q
        questions.append(q)
assert questions, 'No question PDFs found; existing data preserved'
output.write_text(json.dumps({'books':books,'questions':questions},ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Extracted {len(questions)} questions; {sum(q["answer"] is not None for q in questions)} keys; {sum(q["explanation"] is not None for q in questions)} complete explanations.')
