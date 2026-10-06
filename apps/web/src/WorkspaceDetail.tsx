import {ArrowRight,Box,CheckCircle2,ChevronLeft,GitBranch,Plus,Settings2,ShieldCheck,TerminalSquare} from 'lucide-react';

type Workspace={id:string;name:string;type:string;location:string;branch:string;status:string;updatedAt:string};
type Task={id:string;workspaceId:string;title:string;description:string;pipeline:string[];status:string;updatedAt:string};

type Props={workspace:Workspace;tasks:Task[];onBack:()=>void;onNew:()=>void;onTask:(task:Task)=>void};

export function WorkspaceDetail({workspace,tasks,onBack,onNew,onTask}:Props){
  return <div className="content workspace-detail">
    <button className="back" onClick={onBack}><ChevronLeft size={16}/> All workspaces</button>
    <div className="workspace-detail-grid">
      <section className="workspace-primary">
        <div className="workspace-banner">
          <div className="workspace-banner-copy">
            <span className="type-pill"><GitBranch size={13}/>{workspace.type} workspace</span>
            <h2>{workspace.name}</h2>
            <p>{workspace.location} · branch {workspace.branch}</p>
          </div>
          <div className="banner-actions"><button className="secondary"><CheckCircle2 size={15}/> Resume workspace</button><button className="primary" onClick={onNew}><Plus size={15}/> New task</button></div>
        </div>
        <div className="workspace-summary" aria-label="Workspace summary">
          <div className="summary-card"><span>Tasks</span><strong>{tasks.length.toString().padStart(2,'0')}</strong><small>recent work items</small></div>
          <div className="summary-card"><span>Branch</span><strong>{workspace.branch||'main'}</strong><small>registered checkout</small></div>
          <div className="summary-card"><span>Status</span><strong>{workspace.status}</strong><small>workspace health</small></div>
        </div>
        <div className="section-head workspace-section-head"><div><p className="eyebrow">WORK QUEUE</p><h3>Recent tasks <small>{tasks.length.toString().padStart(2,'0')}</small></h3></div></div>
        {tasks.length?<div className="task-list">{tasks.map(task=><button className="task-row" key={task.id} onClick={()=>onTask(task)}><div className="task-icon"><TerminalSquare size={17}/></div><div className="task-main"><strong>{task.title}</strong><span>{task.description}</span></div><span className={`task-status ${task.status}`}>{task.status.replace('_',' ')}</span><ArrowRight size={16}/></button>)}</div>:<div className="empty"><TerminalSquare size={22}/><strong>No tasks in this workspace</strong><span>Create a task to run the mock pipeline.</span><button className="secondary" onClick={onNew}>Create task</button></div>}
      </section>
      <aside className="workspace-rail" aria-label="Workspace context">
        <section className="rail-card"><div className="rail-card-title"><span>Git</span><GitBranch size={15}/></div><div className="rail-value">{workspace.branch||'main'}</div><small>{workspace.location}</small></section>
        <section className="rail-card"><div className="rail-card-title"><span>Environments</span><Box size={15}/></div><div className="rail-list"><span><i className="rail-dot"/>Local workspace</span><b>ready</b></div></section>
        <section className="rail-card"><div className="rail-card-title"><span>Project context</span><ShieldCheck size={15}/></div><p className="rail-copy">Registered workspace rules and artifacts stay scoped to this project.</p></section>
        <section className="rail-card"><div className="rail-card-title"><span>Workspace agents</span><Settings2 size={15}/></div><div className="rail-agent"><span>Planner</span><b>Mock / mock-fast</b></div><div className="rail-agent"><span>Developer</span><b>Claude Code / sonnet</b></div><div className="rail-agent"><span>Tester</span><b>Command Tester / local-command-runner</b></div><div className="rail-agent"><span>Reviewer</span><b>Codex CLI / gpt-5.6-luna</b></div></section>
        <section className="rail-card"><div className="rail-card-title"><span>Configuration</span><Settings2 size={15}/></div><div className="rail-list"><span>Destructive actions</span><b>denied</b></div><div className="rail-list"><span>Workspace scope</span><b>local only</b></div></section>
      </aside>
    </div>
  </div>;
}
