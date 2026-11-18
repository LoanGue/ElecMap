# Changesets

Each pull request that changes the published package should add a changeset:

```sh
npx changeset
```

The release workflow turns accumulated changesets into a version bump, a `CHANGELOG.md` entry and an npm publish.
