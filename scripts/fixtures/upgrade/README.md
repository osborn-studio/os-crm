# Historical migration fixtures

Schema and migrations only, extracted verbatim from the public source commits in manifest.json. No seeds, accounts or business records. Tests validate the compressed hash before extracting into an isolated temporary folder, then verify historical columns and perform actual MySQL upgrade checks. Bundling the fixed fixtures makes tests reproducible from either repository or a source ZIP without unrelated Git refs.
