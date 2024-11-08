<script setup lang="ts">
import { computed } from 'vue'
const { diagnostic, base, order } = defineProps<{
  diagnostic: any
  base: string
  order: boolean
}>()

interface Link {
  textContent: string
  onclick: any
}

function calcLink(text: string) {
  let curIndex = 0
  let match
  const links: Link[] = []
  while ((match = fileRE.exec(text))) {
    const { 0: file, index } = match
    if (index !== null) {
      const frag = text.slice(curIndex, index)
      const link: Link = {
        textContent: file,
        onclick: () => {
          fetch(`${base}__open-in-editor?file=` + encodeURIComponent(file))
        },
      }

      curIndex += frag.length + file.length
      links.push(link)
    }
  }

  return links
}

const checkerColorMap: Record<string, string> = {
  TypeScript: '#3178c6',
  ESLint: '#7b7fe3',
  Biome: '#60a5fa',
  VLS: '#64b587',
  'vue-tsc': '#64b587',
  Stylelint: '#ffffff',
} as const

const fileRE = /(?:[a-zA-Z]:\\|\/).*(:\d+:\d+)?/g
const codeFrameRE = /^(?:>?\s+\d+\s+\|.*|\s+\|\s*\^.*)\r?\n/gm
codeFrameRE.lastIndex = 0

const hasFrame = computed(() => {
  return diagnostic.frame && codeFrameRE.test(diagnostic.frame)
})

const file = computed(() => {
  return (diagnostic.loc?.file || diagnostic.id || 'unknown file').split(`?`)
}).value[0]

const errorSource = computed(() => {
  return {
    ...calcLink(
      `${file}` + (diagnostic.loc ? `:${diagnostic.loc.line}:${diagnostic.loc.column}` : '')
    )[0],
    linkFiles: true,
  }
})
</script>

<template>
  <li :class="`${order ? 'ordered-' : ''}message-item`">
    <pre class="message">
    <!-- @vue-ignore -->
    <span class="plugin" :style="{ color: checkerColorMap[diagnostic.checkerId] }"
      >{{ `[${diagnostic.checkerId}]` }} </span
    ><span :class="['message-body', `message-body-${diagnostic.level}`]">{{ diagnostic.message }}</span>
  </pre>
    <pre
      class="file"
    ><a class="file-link" @click="errorSource.onclick">{{ errorSource.textContent }}</a></pre>
    <pre v-if="hasFrame" class="frame"><code class="frame-code">{{ diagnostic.frame }}</code></pre>
    <pre class="stack">{{ diagnostic.stack }}</pre>
  </li>
</template>

<style>
li {
  list-style: none;
}

.message-item, .ordered-message-item {
  border-bottom: 1px dotted #666;
  padding: 12px 0 0 0;
}

.ordered-message-item:has(.message-body-0) {
    order: 1;
}

.ordered-message-item:has(.message-body-1) {
    order: 0;
}

.ordered-message-item:has(.message-body-2) {
    order: 2;
}

.ordered-message-item:has(.message-body-3) {
    order: 3;
}

.message {
  white-space: initial;
  font-weight: 600;
}

pre {
  font-family: var(--monospace);
  font-size: 14px;
  margin-top: 0;
  margin-bottom: 0;
  overflow-x: scroll;
  scrollbar-width: none;
}

.frame {
  margin: 1em 0;
  padding: 6px 8px;
  background: rgba(22, 24, 29, 0.85);
  margin-top: 8px;
  border-radius: 8px;
}

.frame-code {
  color: var(--yellow);
  font-family: var(--monospace);
}

pre::-webkit-scrollbar {
  display: none;
}

.message-body {
  color: var(--red);
}

/* warning */
.message-body-0 {
  color: var(--yellow);
}

/* error */
.message-body-1 {
  color: var(--red);
}

/* suggestion */
.message-body-2 {
  color: var(--blue);
}

/* message */
.message-body-3 {
  color: var(--dim);
}

.file {
  color: var(--cyan);
  margin-bottom: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.stack {
  font-size: 13px;
  color: var(--dim);
}

.file-link {
  text-decoration: underline;
  cursor: pointer;
}
</style>
