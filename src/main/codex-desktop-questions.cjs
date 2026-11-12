"use strict";

// Desktop returns {accepted:true} before the person answers. Keep questions
// separate from the tool lifecycle: unrelated tools can run in the meantime.
function applyDesktopQuestion(file, record) {
  if (record.type !== 'response_item' || file.isSubagent) return;
  const p = record.payload || {};
  const pending = file.desktopQuestions;
  if (p.type === 'function_call' && p.name === 'request_user_input_async' && typeof p.call_id === 'string') {
    let args; try { args = JSON.parse(p.arguments); } catch { return; }
    if (!Array.isArray(args?.questions) || pending?.has(p.call_id)) return;
    const questions = args.questions.slice(0,16).flatMap((q,i) => typeof q?.title === 'string' && q.title.trim()
      ? [{id:String(i), question:q.title.slice(0,1024), type:'single', choices:[]}] : []);
    if (!questions.length) return;
    file.desktopQuestions ??= new Map();
    file.desktopQuestions.set(p.call_id, {id:p.call_id, sessionId:file.sessionId, desktopOnly:true, questions});
    return 'asked';
  }
  if (!pending?.size) return;
  if (p.type === 'function_call_output' && pending.has(p.call_id)) {
    let result; try { result = JSON.parse(p.output); } catch { result = null; }
    if (result?.accepted === true) return;
    pending.delete(p.call_id);
    return 'resolved';
  }
  if (p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return;
  let changed = false;
  for (const part of p.content) {
    if (part.type !== 'input_text' || typeof part.text !== 'string') continue;
    const match = /^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(part.text);
    if (!match) continue;
    let replies; try { replies = JSON.parse(match[1]); } catch { continue; }
    for (const reply of Array.isArray(replies) ? replies : []) {
      let key; try { key = JSON.parse(reply.questionItemId); } catch { continue; }
      if (!Array.isArray(key) || key[0] !== 'request_user_input_async') continue;
      const prompt = pending.get(key[1]);
      if (!prompt || !prompt.questions.some(q=>q.id===String(key[2]))) continue;
      prompt.questions = prompt.questions.filter(q=>q.id!==String(key[2]));
      if (!prompt.questions.length) pending.delete(key[1]);
      changed = true;
    }
  }
  if (changed) return 'resolved';
}

function withDesktopQuestions(sessions, watcher) {
  return sessions.map(session => {
    if (session.tool !== 'codex' || session.isRemote || session.phase === 'waitingForApproval' || session.questionPrompt || session.phase === 'completed') return session;
    const pending = watcher?.files.get(session.id)?.desktopQuestions;
    if (!pending?.size) return session;
    const prompts = Array.from(pending.values());
    return {...session, phase:'waitingForAnswer', questionPrompt:{...prompts.at(-1),questions:prompts.flatMap(p=>p.questions.map(q=>({...q,id:p.id+':'+q.id})))}};
  });
}
module.exports = {applyDesktopQuestion, withDesktopQuestions};
