# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **ST-VarSystemExtension**, a frontend extension for SillyTavern that provides visual variable management for character conversations. It works in conjunction with the backend plugin [ST-VarSystemPlugin](https://github.com/scientar/ST-VarSystemPlugin).

**Important Notes:**

- The codebase is primarily in **Chinese (中文)**
- Comments, UI text, and documentation use Chinese
- This is a SillyTavern third-party extension built with Vue 3 + TypeScript

## Build and Development Commands

### Essential Commands

```bash
# Build for production
pnpm run build

# Watch mode for development (rebuilds on file changes)
pnpm watch

# Format code
pnpm format

# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Run tests
pnpm test
```

### Build Output

- Builds to `dist/` directory
- Entry point: `dist/index.js` (referenced in manifest.json)
- CSS: `dist/index.css`
- Deployment location: SillyTavern's `public/scripts/extensions/third-party/ST-VarSystemExtension/`

### Development Workflow

1. Make code changes in `src/`
2. Run `pnpm watch` for live rebuilding
3. Refresh SillyTavern to test changes
4. The extension auto-initializes when SillyTavern loads (see `$(async () => {...})` at end of index.ts)

## High-Level Architecture

### Core Module Structure

```
src/
├── index.ts              # Extension entry point, UI injection, tab management
├── editor/               # JSON editor wrapper (vanilla-jsoneditor)
│   └── variableBlockEditor.ts
├── events/               # Event system - core reactive layer
│   ├── listeners.ts      # SillyTavern event handlers
│   ├── processor.ts      # Message processing and snapshot generation
│   ├── variableInjector.ts  # Inject variables into chat context
│   └── statusPlaceholder.ts # Placeholder tags in AI messages
├── functions/            # Function system (MVU/SAM syntax)
│   ├── parser.ts         # Parse function calls from AI messages
│   ├── executor.ts       # Execute functions against variables
│   ├── registry.ts       # Function registry (global + local)
│   └── builtins.ts       # Built-in function definitions
├── snapshots/            # Snapshot management
│   ├── snapshotIdentifier.ts  # Generate/parse snapshot IDs
│   ├── snapshotResolver.ts    # Resolve snapshots from plugin
│   └── messageUtils.ts        # Message-level utilities
├── template/             # Template system (character-specific)
│   ├── parser.ts         # Parse template format
│   ├── serializer.ts     # Serialize templates
│   └── types.d.ts        # Template type definitions
└── ui/                   # UI components and views
    ├── components/       # Reusable Vue components
    ├── functionLibrary.ts/html   # Function management UI
    ├── messageSnapshots.ts/html  # Message-level snapshot viewer
    ├── settings.ts/html          # Extension settings
    └── reprocessMenuItem.vue     # Context menu item
```

### Key Architectural Patterns

#### 1. Event-Driven Architecture

The extension reacts to SillyTavern events (from `@sillytavern/script`):

- `MESSAGE_RECEIVED`: AI generates new message → process and create snapshot
- `MESSAGE_SWIPED`: User switches swipe → reprocess up to that swipe
- `CHAT_CHANGED`: Switch chat → clear variables, load character template
- `MESSAGE_DELETED`: Delete message → reprocess subsequent messages
- `CHAT_DELETED`: Delete entire chat → cleanup snapshots via plugin

**Core Flow**: `listeners.ts` → `processor.ts` → `executor.ts` → `variableInjector.ts`

#### 2. Three-Layer Variable System

1. **Character Templates** (`templateState` in index.ts)
   - Initial variable state per character card
   - Stored in `character.data.extensions.st_var_system.templateBody`
   - Can be enabled/disabled per character

2. **Global Snapshots** (`snapshotsState` in index.ts)
   - Reusable variable states across characters/chats
   - Stored in plugin backend (SQLite)
   - Managed via plugin API (`/api/plugins/var-manager/var-manager/global-snapshots`)

3. **Message Snapshots** (managed by `events/processor.ts`)
   - Variable state at each AI message
   - Linked to messages via `<VarSystemStatusPlaceholder/>` tags
   - Latest snapshot injected as `vs_stat_data` chat variable

#### 3. Function System

Two function types:

- **Active Functions**: AI explicitly calls them (matched from AI messages by function name)
- **Passive Functions**: Auto-execute before/after active functions

Function sources:

- **Global Functions**: `extension_settings.st_var_system.functions` (all characters)
- **Local Functions**: `character.data.extensions.st_var_system.functions` (character-specific)

**Function Parsing (Updated)**:

The system uses `character-parser` library for robust argument extraction:

1. **Function Name Matching**: Matches `@.FUNCTION_NAME(` format
2. **Smart Argument Extraction**: Correctly handles:
   - Parentheses in quoted strings: `@.ADD("a", "我(me)的")`
   - Nested objects: `@.SET("data", {"name": "value"})`
   - Escaped quotes: `@.ADD("msg", "say \"hi\"")`
   - Commas in quoted strings: `@.ADD("a", "b,c,d")`
3. **Sequential Execution**: Multiple calls are executed in text order:
   ```javascript
   @.ADD("x", 1); @.SET("y", 2); @.ADD("x", 3);
   // Executed as: ADD → SET → ADD (result: {x: 4, y: 2})
   ```

**Pattern Field (Optional)**:
- The `pattern` field in function definitions is now **optional**
- If empty, system auto-generates: `@\.FUNCNAME\(`
- Internal built-in functions don't use the `pattern` field
- Custom patterns are supported for advanced use cases

Execution flow: `parser.ts` → `registry.ts` → `executor.ts`

#### 4. Plugin Integration

Backend plugin handles persistent storage:

```javascript
// Plugin base URL
const PLUGIN_BASE_URL = "/api/plugins/var-manager/var-manager";

// Key endpoints:
// GET  /global-snapshots          - List all snapshots
// POST /global-snapshots          - Create/update snapshot
// GET  /global-snapshots/{id}     - Get specific snapshot
// DELETE /global-snapshots/{id}   - Delete snapshot

// Uses SillyTavern's getRequestHeaders() for CSRF tokens
```

### Path Aliases and Module Resolution

```javascript
// Configured in tsconfig.json and vite.config.ts

"@/"              → "src/"               // Project files
"@sillytavern/*"  → "../../../../*"     // SillyTavern core
                                         // (relative from extension install path)
```

**Important**: The extension is installed at:

```
public/scripts/extensions/third-party/ST-VarSystemExtension/
```

So `@sillytavern/script` resolves to `public/script.js`

### External Dependencies

**Externalized** (provided by SillyTavern):

- `jquery` → `$`
- `hljs` → `hljs`
- `toastr` → `toastr`
- `@popperjs/core` → `Popper`

**Bundled** (included in extension):

- `lodash` (exposed as `window._` for function executors)
- `vue`, `pinia`, `@vueuse/*`
- `vanilla-jsoneditor`
- `tailwindcss`
- `character-parser` (for robust function argument parsing)

## Key Technical Concepts

### MVU Schema Stripping

The extension supports migrating data from [MagVarUpdate (MVU)](https://github.com/MagicalAstrogy/MagVarUpdate):

```javascript
// stripMvuSchema() removes:
// - All object keys starting with "$" (e.g., $meta, $arrayMeta)
// - Array entries matching "$__META_EXTENSIBLE__$"

function stripMvuSchema(obj) {
  // Recursively clean MVU metadata from variables
}
```

Use cases:

- Import MVU-format JSON files
- Clean up migrated character templates
- Export pure data for cross-system compatibility

### Snapshot Normalization

Old vs. new snapshot format handling:

```javascript
// Old format (legacy):
{ metadata: {...}, variables: {...} }

// New format (current):
{ ...variables }  // Direct variable object

// normalizeSnapshotBody() handles both automatically
```

### CSRF Token Management

```javascript
// Uses SillyTavern's standard headers
import { getRequestHeaders } from "@sillytavern/script";

const headers = {
  ...getRequestHeaders(), // Includes CSRF token
  "Content-Type": "application/json",
};
```

### Extension Manifest

```json
{
  "display_name": "变量系统扩展",
  "loading_order": 100, // Load order relative to other extensions
  "requires": [], // No hard dependencies
  "js": "dist/index.js",
  "css": "dist/index.css",
  "auto_update": true // Enable auto-updates from repo
}
```

## UI and State Management

### Tab System

Five main tabs (managed in `index.ts`):

1. `character` - Character template editor
2. `global` - Global snapshots manager
3. `messages` - Message-level snapshot viewer
4. `functions` - Function library
5. `settings` - Extension settings

Tab switching handled by `switchTab(tabName)` which:

- Updates tab button styles
- Shows/hides corresponding content sections
- Triggers tab-specific initialization (e.g., loading snapshots)

### Editor Integration

Uses `vanilla-jsoneditor` wrapped in `variableBlockEditor.ts`:

```javascript
createVariableBlockEditor({
  container, // DOM element
  initialValue, // Initial JSON
  readOnly, // Editor mode
  onChange, // Change callback
  onFallback, // Fallback to text mode if JSON editor fails
});
```

**Key pattern**: Editor content validation via `content?.json === undefined`:

- `content.json === undefined` → Parse error (invalid JSON)
- `content.json === null` → Valid (null value)
- `content.json === {}` → Valid (empty object)

### Status Management

Common pattern across UI modules:

```javascript
const state = {
  loading: false, // Currently loading
  dirty: false, // Has unsaved changes
  hasErrors: false, // JSON parse errors
  // ... module-specific state
};

function updateControls() {
  // Enable/disable buttons based on state
}

function updateStatus(message, level) {
  // Update status display with color coding
  // Levels: 'success', 'error', 'warn', 'info'
}
```

## Development Considerations

### Testing Changes

1. **Local development**:

   ```bash
   # In extension directory
   pnpm watch
   ```

2. **In SillyTavern**:
   - Navigate to `public/scripts/extensions/third-party/ST-VarSystemExtension/`
   - Create symlink to development directory, OR
   - Copy built files from `dist/` to deployment location
   - Refresh SillyTavern (Ctrl+R / Cmd+R)

3. **Debugging**:
   - Open browser DevTools
   - Look for `[ST-VarSystemExtension]` logs
   - Check Network tab for plugin API calls

### Common Gotchas

1. **Path Resolution**: Always use `@/` or `@sillytavern/` aliases, not relative paths
2. **Editor Initialization**: Must call `ensureReady()` after creating editor instance
3. **Tab Visibility**: Editors in hidden tabs may not initialize properly; switch view first
4. **CSRF Tokens**: Always use `getRequestHeaders()` for authenticated requests
5. **Snapshot Format**: Use `normalizeSnapshotBody()` when loading snapshots from any source

### Extension Initialization Flow

```javascript
// Auto-initialization on page load
$(async () => {
  await initExtension();
});

// initExtension() does:
// 1. Inject UI (drawer) into SillyTavern header
// 2. Bind tab switching
// 3. Initialize each tab's UI (templates, snapshots, functions, settings)
// 4. Register event listeners for SillyTavern events
// 5. Mount Vue components (e.g., reprocessMenuItem)
```

### Character Data Extension Storage

Character-specific data stored at:

```javascript
character.data.extensions['st_var_system'] = {
  templateBody: {...},     // Variable template JSON
  enabled: true/false,     // Whether system is enabled
  functions: [...]         // Local functions (optional)
}
```

Global settings stored at:

```javascript
extension_settings.st_var_system = {
  functions: [...],        // Global functions
  // ... other settings
}
```

## Important Files for Common Tasks

### Adding a new feature:

1. Check if it belongs to events, functions, snapshots, or ui
2. Follow existing patterns in that module
3. Update `index.ts` if it needs UI integration
4. Add event listeners in `events/listeners.ts` if reactive

### Modifying UI:

1. HTML templates: `src/ui/*.html` or `assets/templates/*.html`
2. Vue components: `src/ui/components/*.vue`
3. Styles: `src/ui/design-system.scss` or `src/ui/phase4.css`
4. Logic: Corresponding `src/ui/*.ts` files

### Plugin API changes:

1. Update endpoint URLs in `index.ts` (`PLUGIN_BASE_URL` constants)
2. Modify request/response handling in `callPluginAPI()`
3. Update type definitions if response format changes

### Adding new events:

1. Add listener in `events/listeners.ts`
2. Import event type from `@sillytavern/script`
3. Register in `registerEventListeners()`, unregister in `unregisterEventListeners()`
