# Configurations

Shared configuration to control the checker behaviors of the plugin.

```ts
{
  /**
   * Show overlay on UI view when there are errors or warnings in dev mode.
   * - Set `true` to show overlay
   * - Set `false` to disable overlay
   * - Set with a object to customize overlay
   *
   * @defaultValue `true`
   */
  overlay:
    | boolean
    | {
        /**
         * Whether to default the overlay to being open
         * - Set `true` to initially open if errors/warnings are found
         * - Set `error` to initially open if errors are found
         * - Set `false` to initially collapse
         * @defaultValue `true`
         */
        initialIsOpen?: boolean | 'error'
        /**
         * The position of the vite-plugin-checker badge to open and close
         * the diagnostics panel
         * @default `bl`
         */
        position?: 'tl' | 'tr' | 'bl' | 'br'
        /**
         * Use this to add extra style string to the badge button, the string format is
         * [HTML element's style property](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style)
         * For example, if you want to hide the badge,
         * you can pass `display: none;` to the badgeStyle property
         * @default no default value
         */
        badgeStyle?: string
        /**
         * Use this to add extra style string to the diagnostic panel, the string format is
         * [HTML element's style property:](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style)
         * For example, if you want to change the opacity of the panel,
         * you can pass `opacity: 0.8;` to the panelStyle property
         * @default no default value
         */
        panelStyle?: string
        /**
         * The sort order of the messages in overlay:
         * - Set `gravity` to sort by message gravity (errors first, warnings second, suggestions third & messages fourth).
         * - Set nothing to keep default sort order.
         * @default no default value
         */
        messageOrder?: 'gravity'
      }
  /**
   * stdout in terminal which starts the Vite server in dev mode.
   * - Set `true` to enable
   * - Set `false` to disable
   *
   * @defaultValue `true`
   */
  terminal: boolean
  /**
   * Enable checking in build mode
   * @defaultValue `true`
   */
  enableBuild: boolean

  /**
   * Configure root directory of checkers
   * @defaultValue no default value
   */
  root?: boolean;
}
```
