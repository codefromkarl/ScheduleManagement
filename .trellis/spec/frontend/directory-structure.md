# Directory Structure

## Current Layout

```text
web/
├── src/app/                 # Next App Router routes, layout, metadata, manifest
├── src/components/          # Cross-feature shell and product components
│   └── ui/                  # Project-owned shadcn/Radix-style primitives
├── src/features/<feature>/  # Domain models and feature-specific modules
├── src/lib/                 # Shared pure utilities such as cn()
├── public/                  # PWA assets and static files
└── package.json
```

## Module Organization

- Keep route entrypoints in `src/app` thin; import feature or shell components instead of putting a full domain implementation in `page.tsx`.
- Put stable domain types next to the feature that owns them (`src/features/schedule/model.ts` currently owns schedule unions and demo data).
- Put reusable interaction primitives in `src/components/ui`, not inside a feature folder.
- Keep provider adapters, database access, and scheduling services out of React components; they will be added as server-side modules when the backend slice begins.

## Naming

- Components use PascalCase filenames and named exports.
- Hooks use `use*` names and live with the feature or in `src/hooks` when shared.
- Domain values use explicit string unions or named types; display labels are separate maps.
- Use the `@/*` alias for imports from `src`.
