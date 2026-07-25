const appRoot = document.querySelector("[data-app-root]");

if (appRoot) {
  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">W</span>
          <div>
            <strong>Wordless</strong>
            <p>Desktop shell</p>
          </div>
        </div>
        <nav class="profiles">
          <button type="button" class="profile is-active">General</button>
          <button type="button" class="profile">Coding</button>
          <button type="button" class="profile">PPT</button>
          <button type="button" class="profile">Excel</button>
          <button type="button" class="profile">Data</button>
          <button type="button" class="profile">UI</button>
        </nav>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">Agent Workspace</p>
            <h1>Framework shell only</h1>
          </div>
          <div class="status">No runtime attached</div>
        </header>

        <section class="hero">
          <div class="panel">
            <h2>Desktop app</h2>
            <p>Main process, preload, renderer entry points are in place.</p>
          </div>
          <div class="panel">
            <h2>Shared runtime</h2>
            <p>Reserved for wrappers around <code>packages/ai</code> and <code>packages/agent</code>.</p>
          </div>
          <div class="panel">
            <h2>Profiles</h2>
            <p>Reserved for general, coding, PPT, Excel, data, and UI profiles.</p>
          </div>
        </section>
      </main>
    </div>
  `;
}
