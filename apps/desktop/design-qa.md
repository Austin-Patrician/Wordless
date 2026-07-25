**Findings**
- No implementation screenshot could be captured in this environment.
  Location: ModelPicker visual comparison.
  Evidence: the Figma Make source was read through the Figma MCP, and the local Vite server is reachable, but Chromium, Playwright, and the Electron binary are unavailable.
  Impact: pixel-level comparison cannot be completed here.
  Fix: capture the open ModelPicker at desktop and mobile widths once a browser-capable environment is available.

**Open Questions**
- None.

**Implementation Checklist**
- Figma Make source read through `mcp__figma__get_design_context`.
- `349px` popup width, `20px` radius, `10px` padding, Figma row heights, colors, shadow, glyph treatment, and footer structure applied.
- Runtime model data, selection, compatibility, and custom-model settings navigation retained.
- WorkspacePicker source read through `mcp__figma__get_design_context`.
- `304px` workspace popup width, asymmetric `20px` lower/right corners, `41px` search row, `35px` option rhythm, selected-state checkmark, and two workspace actions applied.
- Workspace search, unscoped-session selection, managed workspace creation, and native local-folder selection retained.
- Model settings source read through `mcp__figma__get_design_context`.
- Model page now uses the Figma custom-model information panel, saved-model list, row actions, and `520px` configuration dialog.
- Provider and model menus are populated from the runtime registry backed by `@wordless/ai/providers/all`; custom endpoints continue through the runtime custom-provider API.

**Follow-up Polish**
- Compare a 430px mobile capture and desktop Composer capture against the Figma Make state.

source visual truth path: https://www.figma.com/make/OaeRpmbd5Ag1od2vBBqQIt/Model-Selection-Popup?t=ypqqmOZL4xTFhvfx-0
workspace source visual truth path: https://www.figma.com/make/cGydvw6YROLLqWhbHICw7m/%E5%AE%9E%E7%8E%B0%E9%80%89%E6%8B%A9%E6%A1%86UI%E6%95%88%E6%9E%9C?t=ypqqmOZL4xTFhvfx-0
model settings source visual truth path: https://www.figma.com/make/RBnG4bF1xz9fnIFZ5NjP2j/%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE%E9%A1%B5%E9%9D%A2?t=vTY9yarNfr7dBCFP-0
implementation screenshot path: unavailable in this environment
viewport: Figma Make reference root, 430px wide
state: ModelPicker open, first model selected, Max mode disabled; WorkspacePicker open, unscoped selection active
full-view comparison evidence: Figma MCP reference implementation and supplied visual
focused region comparison evidence: blocked; no browser screenshot capability
patches made since previous QA: ModelPicker, WorkspacePicker, and Model Settings rebuilt from Figma MCP sources
final result: blocked
