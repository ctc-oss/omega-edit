# Ωedit™ Node Packages

:exclamation: These commands should be executed in the `packages` folder after a successful [build & install](../README.md). :exclamation:

This folder contains different node packages that will be created for `omega-edit`.  These packages are:

* `@omega-edit/server` - The server package for `omega-edit`
* `@omega-edit/client` - The client package for `omega-edit` (Note: `@omega-edit/server` is a dependency of this package)

## How to use these packages while in development

It is often useful to use these packages while they are in development. To do so, you can utilize the `build.sh` script which uses `yarn link` to link the package to your local `node_modules` folder in the project that has Ωedit™ dependencies.  Here is how to do that:

1. In the packages folder, run:
  
```bash
build.sh -l <project-path>
```

This compiles and packages the *client* and *server* directories then creates yarn links to the packaged `out` directory the each respective location.

> **NOTE**: `yarn link` works by taking the linkable package and caching that package, on Unix systems the `yarn` cache path default is `$HOME/.config/yarn/links/<package-name>`.
> Then, when linking a cached package to another project, `yarn link <package-name>`, a symlink is created in the depedency modules folder. This symlink forces dependency
> installations of linked packages to utilize the cached package instead.
>
> When using this method there is no need to try and re-link a cached package because the symlink will always have updated content. All that needs to be done is repacking
> the cached packages project to update it's output directory contents.

2. When you are done, you can unlink the packages by running one of the following:
- `build.sh -d` in the *omega-edit/packages* folder. 
- `yarn unlink <package-name>` in the project folder.
If the project uses npm, you can run `npm unlink <package-name>` instead.

> **NOTE**: `build.sh -d` will fully destroy any links to the *@omega-edit/client* and *@omega-edit/server* links. This includes unlinking through `yarn unlink` and by deleting
> the symlinks in the yarn link cache directory (`$HOME/.config/yarn/links/@omega-edit/{client, server}`).

3. After removing the package links, run the following in the development project which depends on the *@omega-edit* module: 
```bash
yarn unlink @omega-edit/server @omega-edit/client
yarn install
```

This removing the `yarn` force of points these modules to the symlinks and then `yarn install` points towards the publically available modules.
