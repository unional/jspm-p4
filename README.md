# jspm-p4
jspm registry endpoint for Perforce.

# What you need

1. The ability to create labels
2. The ability to create workspace

# Usage

Create a workspace (P4CLIENT) that points to the root of your repository, then:

````
npm install jspm-p4
jspm registry create {myEndpoint} jspm-p4
jspm registry config {myEndpoint}
````

`jspm-p4` relies on `p4 labels` to manage versions. Similar to what you need to do on git/GitHub, when you have a module that is ready to publish, do the following:

1. Update version in `package.json` (this doesn't have real effect, but it is a good practice to keep it consistent with your `label`).
2. Tag the specific `revision/changelist` with a `label` that follows the `semver` convention (create the label if needed).

To avoid unexpected behavior (*mess ups*), do not submit changes from multiple modules in the same revision. Check them in separately. That's the right thing to do anyway.

# Design Direction
* Perforce is a centralized VCS, and it works with a workspace concept. So to use it as a repository for jspm, I rely on checking out the repository locally.  It is the same approach as git-p4.
* Perforce labels can be applied to multiple revisions, so to create a unique hash for each package and versions, I use the hash of `packageName + label`.

# Todo list
* local caching?
* open to any suggestion.
