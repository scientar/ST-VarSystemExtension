# Style & Conventions
- Use ECMAScript modules (import/export) compatible with SillyTavern; rely on provided globals (`window.EDITOR`, jQuery `$`, `renderExtensionTemplateAsync`).
- Follow SillyTavern drawer/menu CSS classes (`drawer`, `menu_button`, `closedIcon/openIcon`) so theming stays consistent.
- Console logs use prefix `[ST-VarSystemExtension]` for tracing.
- Keep DOM IDs/kebab-case aligned with plugin namespace (`var_system_*`).
- Prefer progressive enhancement: check for API availability before using it and degrade gracefully.