<!--
  - SPDX-FileCopyrightText: 2026 Ket4tec
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import {
	getFaceFrameLevel,
	getFaceFrameRange,
	logFaceFrameChoice,
	onFaceFrameLevelChange,
	setFaceFrameLevel,
	setFaceFrameRange,
} from '../../utils/media/pipeline/FaceFrame.js'

// ket4tec (NAS_CLOUD#232): «Автокадрирование» вкл/выкл и «Дальность» по живому превью вместо списка авто/x1/x2
const level = ref<string>(getFaceFrameLevel())
const off = onFaceFrameLevelChange(() => {
	level.value = getFaceFrameLevel()
})
onBeforeUnmount(off)

const enabled = computed({
	get: () => level.value !== 'off',
	set: (value: boolean) => {
		setFaceFrameLevel(value ? 'auto' : 'off')
		logFaceFrameChoice('change')
	},
})

// ket4tec (NAS_CLOUD#232, Андрей 16.11): 5 положений вместо плавного хода; старое плавное значение — к ближайшему
const STEP = 0.25
const range = ref<number>(Math.round(getFaceFrameRange() / STEP) * STEP)
if (range.value !== getFaceFrameRange()) {
	setFaceFrameRange(range.value)
}
/**
 * @param event input ползунка
 */
function onRange(event: Event) {
	range.value = parseFloat((event.target as HTMLInputElement).value)
	setFaceFrameRange(range.value)
	logFaceFrameChoice('change')
}
</script>

<template>
	<div class="face-frame">
		<NcCheckboxRadioSwitch v-model="enabled" type="switch">
			Автокадрирование
		</NcCheckboxRadioSwitch>
		<label v-if="enabled" class="face-frame__range">
			<span>Дальность</span>
			<span class="face-frame__end">дальше</span>
			<input
				type="range"
				min="0"
				max="1"
				:step="STEP"
				:value="range"
				list="k4-face-range-ticks"
				aria-label="Дальность автокадрирования"
				@input="onRange">
			<datalist id="k4-face-range-ticks">
				<option v-for="i in 5" :key="i" :value="(i - 1) * STEP" />
			</datalist>
			<span class="face-frame__end">ближе</span>
		</label>
	</div>
</template>

<style lang="scss" scoped>
.face-frame {
	margin: calc(2 * var(--default-grid-baseline)) 0;

	&__range {
		display: flex;
		gap: calc(2 * var(--default-grid-baseline));
		align-items: center;
		padding-inline: calc(2 * var(--default-grid-baseline));

		input {
			flex: 1;
			min-width: 0;
			accent-color: var(--color-primary-element);
		}
	}

	&__end {
		color: var(--color-text-maxcontrast);
		font-size: var(--font-size-small, 13px);
	}
}
</style>
