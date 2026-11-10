<!--
  - SPDX-FileCopyrightText: 2026 Ket4tec
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import IconFaceRecognition from 'vue-material-design-icons/FaceRecognition.vue'
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
const options = LEVELS.map((id: string) => ({ id, label: labels[id] }))
const selected = computed({
	get: () => options.find((option) => option.id === level.value) ?? null,
	set: (value) => {
		if (value) {
			setFaceFrameLevel(value.id)
		}
	},
})
</script>

<template>
	<div>
		<div class="face-frame">
			<IconFaceRecognition class="face-frame__icon" :size="20" />
			<NcSelect
				v-model="selected"
				inputId="k4-face-frame"
				:options="options"
				label="label"
				ariaLabelCombobox="Кадр по лицу"
				:clearable="false"
				:searchable="false"
				placeholder="Кадр по лицу" />
		</div>
	</div>
</template>

<style lang="scss" scoped>
.face-frame {
	display: flex;
	gap: var(--default-grid-baseline);
	margin: calc(2 * var(--default-grid-baseline)) 0;
	align-items: center;

	&__icon {
		display: flex;
		justify-content: center;
		align-items: center;
		flex-shrink: 0;
		margin-inline-end: var(--default-grid-baseline);
	}

	:deep(.v-select.select) {
		width: 100%;
		min-width: 0;
		margin: 0;
	}

	:deep(.icon-vue) {
		min-width: auto;
		width: 20px;
	}
}
</style>
