# Integration Instructions: 3D Topology Fixer

This guide outlines how to seamlessly integrate the new "3D Topology Fixer" module into your existing `PCF-converter-App`.

The new module replaces the legacy `smart_fixer` module entirely. It operates completely independently of your main app's global state, using its own data-table and settings.

---

## 1. Directory Setup

1. Extract the provided `3DTopo_App` folder into your `js/` directory.
   - You should now have `js/3DTopo_App/`.
2. (Optional but recommended) You may delete the legacy `js/smart_fixer/` directory to clean up unused code.

---

## 2. Dependencies (Tailwind CSS)

Because our 3D Topology UI uses Tailwind CSS, you must include the Tailwind CDN script in your `index.html` `head` section so our classes compile. Alternatively, configure your Vite setup to compile it.

**In `index.html`, inside `<head>`:**

```html
<!-- Add Tailwind CSS for 3DTopo_App -->
<script src="https://cdn.tailwindcss.com"></script>
```

---

## 3. Modifying `index.html`

We need to add the new "3D Topology Fixer" tab to your main navigation, hide the legacy Smart Fixer tab, and create the container where our React app will mount.

**In `index.html` (Navigation Section):**

```diff
<<<<<<< SEARCH
      <button class="nav-btn" id="tab-viewer" role="tab" title="3D Visualization & Analytics">
        <i data-lucide="box"></i>
        <span>3D Viewer</span>
      </button>
      <button class="nav-btn" id="tab-smart_fixer" role="tab" title="3D Smart fixer & Visualization">
        <i data-lucide="wrench"></i>
        <span>3D Smart Fixer</span>
      </button>
=======
      <button class="nav-btn" id="tab-viewer" role="tab" title="3D Visualization & Analytics">
        <i data-lucide="box"></i>
        <span>3D Viewer</span>
      </button>

      <!-- HIDE LEGACY TAB -->
      <button class="nav-btn" id="tab-smart_fixer" role="tab" title="3D Smart fixer & Visualization" style="display: none;">
        <i data-lucide="wrench"></i>
        <span>Legacy Fixer</span>
      </button>

      <!-- NEW 3D TOPOLOGY TAB -->
      <button class="nav-btn" id="tab-3dtopo" role="tab" title="3D Topology Fixer">
        <i data-lucide="wrench"></i>
        <span>3D Topology Fixer</span>
      </button>
>>>>>>> REPLACE
```

**In `index.html` (Main Content Area):**

```diff
<<<<<<< SEARCH
    <section id="panel-viewer" class="tab-panel" role="tabpanel" style="height: 100vh; overflow: hidden; padding-bottom: 0;">
      <!-- Viewer content -->
    </section>

    <!-- 3D Smart Fixer Tab -->
    <section id="panel-smart_fixer" class="tab-panel" role="tabpanel" style="height: 100vh; overflow: hidden; padding-bottom: 0;">
=======
    <section id="panel-viewer" class="tab-panel" role="tabpanel" style="height: 100vh; overflow: hidden; padding-bottom: 0;">
      <!-- Viewer content -->
    </section>

    <!-- NEW 3D TOPOLOGY TAB -->
    <section id="panel-3dtopo" class="tab-panel" role="tabpanel" style="height: 100vh; overflow: hidden; padding-bottom: 0; background: #f8fafc;">
       <div id="3dtopo-root" style="width: 100%; height: 100%; overflow: auto;"></div>
    </section>

    <!-- 3D Smart Fixer Tab (Hidden) -->
    <section id="panel-smart_fixer" class="tab-panel" role="tabpanel" style="display: none;">
>>>>>>> REPLACE
```

---

## 4. Wiring the Tab Manager

Update `js/ui/tab-manager.js` so it recognizes the new `3dtopo` tab.

**In `js/ui/tab-manager.js`:**

```diff
<<<<<<< SEARCH
const TABS = ["input", "mapping", "table-view", "validate", "sequence", "preview", "output", "viewer", "smart_fixer", "config", "master-data", "debug"];
=======
const TABS = ["input", "mapping", "table-view", "validate", "sequence", "preview", "output", "viewer", "smart_fixer", "3dtopo", "config", "master-data", "debug"];
>>>>>>> REPLACE
```

---

## 5. Mounting the App in `app.js`

Finally, we import our mount function and call it during the application boot process.

**In `js/app.js`:**

```diff
<<<<<<< SEARCH
import { initViewerTab } from "./ui/viewer-tab.js";
import { initDebugTab } from "./ui/debug-tab.js";
import { initTabManager, setTabEnabled } from "./ui/tab-manager.js";
=======
import { initViewerTab } from "./ui/viewer-tab.js";
import { initDebugTab } from "./ui/debug-tab.js";
import { initTabManager, setTabEnabled } from "./ui/tab-manager.js";
// Import our new 3D Topo mount function
import { mount3DTopo } from "./3DTopo_App/index.js";
>>>>>>> REPLACE
```

```diff
<<<<<<< SEARCH
    initViewerTab();
    initDebugTab();

    // 4. Initialise Master Data UI (Linelist + Weight + LineDump)
=======
    initViewerTab();
    initDebugTab();

    // Mount the new 3D Topology Fixer Application
    mount3DTopo("3dtopo-root");

    // 4. Initialise Master Data UI (Linelist + Weight + LineDump)
>>>>>>> REPLACE
```

---

## Workflow Once Integrated

1. User imports a CSV/Excel file or a PCF in the main app.
2. User clicks the new **"3D Topology Fixer"** tab in the main sidebar.
3. Our embedded React app will show its **Input PCF** tab.
4. User clicks **"Pull from final PCF"**. Our code will automatically read the raw PCF output from the main app's textareas and populate our isolated state.
5. User navigates through our internal sub-tabs (3DTopo Data Table, 3D Topography, Config, etc.) completely isolated from the main app's standard flow.