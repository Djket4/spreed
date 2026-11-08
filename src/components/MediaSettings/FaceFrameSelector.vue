<!--
  - SPDX-FileCopyrightText: 2026 Ket4tec
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { isIOS } from '../../utils/browserCheck.ts'
import {
	getFaceFrameLevel,
	LEVEL_LABELS,
	LEVELS,
	onFaceFrameLevelChange,
	setFaceFrameLevel,
} from '../../utils/media/pipeline/FaceFrame.js'

const level = ref<string>(getFaceFrameLevel())
const off = onFaceFrameLevelChange(() => {
	level.value = getFaceFrameLevel()
})
onBeforeUnmount(off)

const labels = LEVEL_LABELS as Record<string, string>
</script>

<template>
	<div class="face-frame">
		<label class="face-frame__label" for="k4-face-frame">Кадр по лицу</label>
		<select
			id="k4-face-frame"
			class="face-frame__select"
			:value="level"
			@change="setFaceFrameLevel(($event.target as HTMLSelectElement).value)">
			<option v-for="item in LEVELS" :key="item" :value="item">
				{{ labels[item] }}
			</option>
		</select>
		<p v-if="isIOS" class="face-frame__hint">
			Если включён «Центр внимания» в Пункте управления, авто-кадр можно выключить
		</p>
	</div>
</template>

<style lang="scss" scoped>
.face-frame {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-block: 8px;

	&__select {
		width: 100%;
	}

	&__hint {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
	}
}
</style>
