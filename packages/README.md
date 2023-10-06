# Ωedit™ Node Packages

:exclamation: These commands should be executed in the `packages` folder after a successful [build](../README.md). :exclamation:

This folder contains different node packages that will be created for `omega-edit`.  These packages are:

* `@omega-edit/server` - The server package for `omega-edit`
* `@omega-edit/client` - The client package for `omega-edit` (Note: `@omega-edit/server` is a dependency of this package)

## How to use these packages while in development

It is often useful to use these packages while they are in development. To do so, you can use `yarn link` to link the package to your
local `node_modules` folder in the project that has Ωedit™ dependencies.  Here is how to do that:

1. In the packages folder, run `yarn link`.

```bash
yarn --cwd server link
yarn --cwd client link
```

2. In the project folder that you want to use the packages in, run `yarn link <package-name>`.  If the project uses npm,
you can run `npm link <package-name>` instead.

```bash
yarn link @omega-edit/server @omega-edit/client
```

3. Now you can use the packages in your project as if they were installed from yarn/npm.

4. When you are done, you can unlink the packages by running `yarn unlink <package-name>` in the project folder. If the
project uses npm, you can run `npm unlink <package-name>` instead.

```bash
yarn unlink @omega-edit/server @omega-edit/client
```

5. You can also unlink the packages from the package folder by running `yarn unlink` in the package folder.

```bash
yarn --cwd server unlink
yarn --cwd client unlink
```
