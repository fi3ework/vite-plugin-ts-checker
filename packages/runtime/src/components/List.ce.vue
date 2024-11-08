<script setup lang="ts">
import Checker from './Checker.ce.vue'

withDefaults(
  defineProps<{
    ulStyle?: string
    base: string
    checkerResults: any[]
    order: boolean
  }>(),
  {
    ulStyle: '',
  }
)
</script>

<template>
  <ul :style="ulStyle">
    <li v-for="(checkerResult, index) in checkerResults" :key="index">
      <Checker :diagnostics="checkerResult.diagnostics" :base="base" :order="order" :index="index" />
    </li>
  </ul>
</template>

<style>
ul,
li {
  list-style: none;
}

ul {
  padding-inline: 0;
  margin-block: 0;
}
</style>
