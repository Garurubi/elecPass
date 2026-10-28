import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {grade,accuracy,shuffle} from '../src/logic.mjs';
const {questions,books}=JSON.parse(readFileSync(new URL('../src/questions.json',import.meta.url),'utf8'));
test('PDF corpus has unique, complete question sequences and intact choices',()=>{
 assert.equal(questions.length,180);assert.equal(new Set(questions.map(q=>q.id)).size,180);
 for(const b of books)assert.deepEqual(questions.filter(q=>q.bookId===b.id).map(q=>q.number),Array.from({length:30},(_,i)=>i+1));
 for(const q of questions){assert.ok(q.prompt.length>10);assert.ok(q.page>0);assert.ok(!q.prompt.includes('제2부.'));if(q.type==='choice'){assert.equal(q.options.length,4);assert.ok(q.options.every(x=>x.length>0));}}
 assert.equal(questions.filter(q=>q.answer).length,180);
});
test('answer key matches the source quick-answer table',()=>{
 const qs=questions.filter(q=>q.bookId==='book-1');
 assert.deepEqual(qs.slice(0,5).map(q=>q.answer[0]),['O','X','O','O','X']);
 assert.deepEqual(qs.slice(5,10).map(q=>q.answer),['부싱 (Bushing)','ㄱ, ㄷ','리듀서 (Reducer)','ㄱ, ㄷ, ㄹ','방폭형 콘센트']);
 assert.deepEqual(qs.slice(10).map(q=>q.answer[0]),['①','③','③','③','③','②','②','③','②','②','④','③','④','②','②','②','①','②','②','③']);
 assert.equal(qs.filter(q=>q.explanation).length,5);
 assert.ok(qs.slice(5).every(q=>q.explanation===null&&q.explanationNote));
 assert.ok(qs.every(q=>q.answerSourceFile.endsWith('(답안포함).pdf')&&q.answerPage>=5));
 assert.ok(qs.every(q=>q.id===`book-1-q${String(q.number).padStart(2,'0')}`));
 assert.equal(qs[24].options[1],'◐');
 assert.ok(questions.every(q=>!q.prompt.includes('____')&&!q.prompt.includes('[학습')));

});

test('combined PDFs retain stable IDs, topics and metadata without answer leakage',()=>{
 for(const id of ['book-1','book-2','book-3']){
  const qs=questions.filter(q=>q.bookId===id);
  assert.equal(qs.length,30);
  assert.ok(qs.every(q=>q.sourceFile===q.answerSourceFile&&q.sourceFile.includes('(답안포함)')));
  assert.ok(qs.every(q=>q.topic!=='전기설비'));
  assert.ok(qs.every(q=>![q.prompt,...q.options].some(t=>/제\d과목|정답표|상세 해설|학\s*습\s*\d|■/.test(t))));
 }
 assert.ok(questions.find(q=>q.id==='book-2-q08').prompt.includes('전구색'));
 assert.ok(questions.find(q=>q.id==='book-3-q11').prompt.includes('[K]'));
});
test('grading excludes missing keys and subjective responses, not unanswered objective questions',()=>{
 assert.equal(grade({type:'ox',answer:'O (참)'},'O'),true);
 assert.equal(grade({type:'choice',answer:'②'},'①'),false);
 assert.equal(grade({type:'choice',answer:'②'},''),false);
 assert.equal(grade({type:'short',answer:'검상기'},'검상기'),null);
 assert.equal(grade({type:'ox',answer:null},'O'),null);
 assert.equal(accuracy([{correct:true},{correct:false},{correct:null}]),50);
 assert.equal(accuracy([{correct:null}]),null);
});
test('random practice retains unique question identities without modifying source',()=>{
 const source=[1,2,3,4];const result=shuffle(source,()=>.2);assert.deepEqual([...result].sort(),source);assert.deepEqual(source,[1,2,3,4]);assert.notEqual(result,source);
});

test('new books preserve types, handle conflicting keys, and include scanned answers',()=>{
 assert.equal(books.length,6);
 assert.equal(questions.filter(q=>q.explanation).length,155);
 for(const book of books){const qs=questions.filter(q=>q.bookId===book.id);assert.equal(qs.filter(q=>q.type==='choice').length,20);assert.equal(qs.filter(q=>q.type==='short').length,5);assert.equal(qs.filter(q=>q.type==='ox').length,5);}
 const conflict=questions.find(q=>q.id==='book-2-q14');
 assert.equal(conflict.answer,'③');assert.match(conflict.answerNote,/사용자 확인으로 정답 ③/);assert.equal(grade(conflict,'③'),true);
 const scan=questions.filter(q=>q.sourceFile.includes('접지')&&q.sourceFile.endsWith('문제2.pdf'));
 assert.ok(scan.slice(0,20).every(q=>q.type==='choice'));
 assert.ok(scan.slice(20,25).every(q=>q.type==='short'));
 assert.ok(scan.slice(25).every(q=>q.type==='ox'));
 assert.deepEqual(scan.slice(0,20).map(q=>q.answer),['③','④','②','②','①','③','②','①','③','③','③','④','④','④','①','①','④','④','②','③']);
 assert.ok(scan.every(q=>q.explanation&&q.reference.includes('원문 해설 요약')));
 assert.ok(questions.every(q=>!q.explanation?.includes('종합 모의고사 |')));
 const grounding=questions.find(q=>q.id==='book-4-q02');assert.ok(grounding.prompt.includes('400 [K]'));
});
