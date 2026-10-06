export type AppView='dashboard'|'workspaces'|'workspace'|'task'|'events';
export function sidebarViewIsActive(view:AppView,item:'dashboard'|'workspaces'){return item==='dashboard'?view==='dashboard':view==='workspaces'||view==='workspace'||view==='task'}
export function backFromTask():AppView{return 'workspace'}
export function backFromWorkspace():AppView{return 'workspaces'}
