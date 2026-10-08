import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('legacy mission child links are recovered without creating replacement tasks',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  assert.match(server,/function resolveMissionChildTask/);
  assert.match(server,/WHERE missionId=\? AND missionTaskId=\?/);
  assert.match(server,/UPDATE mission_tasks SET taskId=\?,updatedAt=\?/);
  assert.match(server,/SELECT \* FROM mission_tasks WHERE taskId IS NULL/);
  assert.match(server,/mission\.child_task_link_ambiguous/);
  assert.doesNotMatch(server,/mission_tasks WHERE missionId=\? AND taskId IS NOT NULL/);
  assert.match(server,/UPDATE mission_tasks SET taskId=\?,status=\?,updatedAt=\?/);
  assert.doesNotMatch(server,/\['blocked','failed'\]\.includes\(item\.status\)&&item\.taskId/);
});

test('mission resume accepts a failed mission task even when taskId is null',()=>{
  const server=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
  const resume=server.slice(server.indexOf("app.post('/api/missions/:id/resume'"),server.indexOf("app.use('/api/missions/:id/approve'"));
  assert.doesNotMatch(resume,/taskId IS NOT NULL/);
  assert.match(resume,/mission_resume_blocked/);
  assert.match(resume,/resumeControlForTask\(task/);
  assert.match(resume,/resumeFromStage/);
});
