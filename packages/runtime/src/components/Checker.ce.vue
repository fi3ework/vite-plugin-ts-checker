<script setup lang="ts">
import Diagnostic from './Diagnostic.ce.vue'

defineProps<{
  diagnostics?: any[]
  base: string
  order: boolean
}>()

const key = (diagnostic: any): string => {
  if (diagnostic.loc) {
    return `${diagnostic.loc.file}-${diagnostic.loc.line}-${diagnostic.loc.column}`;
  } else {
    return diagnostic.id;
  }
}
</script>

<template>
  <ul>
    <Diagnostic v-for="d in diagnostics" :diagnostic="d" :base="base" :order="order" :key="key(d)" />
  </ul>
</template>

<style>
ul {
  list-style: none;
  display: flex;
  flex-direction: column;
}

ul {
  padding-inline: 0;
  margin-block: 0;
}
</style>
