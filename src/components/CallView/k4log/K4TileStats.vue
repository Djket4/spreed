<!--
  - ket4tec: журнал звонка (NAS_CLOUD#189). Цифры связи и предупреждения поверх плитки, только в тест-режиме владельца.
-->

<template>
	<div
		v-if="k4stats.testmode"
		class="k4ts"
		:class="{ 'k4ts--right': right, 'k4ts--compact': compact }"
		data-k4ts>
		<span
			class="k4ts-line"
			:class="compact && worst ? (worst === 'red' ? 'k4ts-red' : 'k4ts-yellow') : ''"><template v-if="compact">{{ kbpsText }}</template>
			<template v-else>
				<span class="k4ts-full">{{ line }}</span><span class="k4ts-short">{{ shortLine }}</span>
			</template>
		</span>
		<span v-if="!compact && s && s.path === 'relay'" class="k4ts-b k4ts-turn">TURN</span>
		<span
			v-for="w in compact ? [] : warns"
			:key="w.w"
			class="k4ts-b"
			:class="w.lvl === 'red' ? 'k4ts-red' : 'k4ts-yellow'">{{ WARN_TEXT[w.w] || w.w }}</span>
	</div>
</template>

<script>
import { k4stats } from '../../../utils/k4stats.js'

const WARN_TEXT = {
	drop: 'обрыв',
	loss: 'потери',
	rtt: 'задержка',
	jit: 'дрожит звук',
	novideo: 'нет видео',
	noaudio: 'нет звука',
	fps: 'рывки',
	own: 'свой канал',
}

const DASH = '—'

export default {
	name: 'K4TileStats',

	props: {
		peerId: {
			type: String,
			required: true,
		},
		/** маленькая плитка (полоса доски): только битрейт, цвет по худшему предупреждению */
		compact: {
			type: Boolean,
			default: false,
		},
		/** верхний правый угол (у плитки со стикером левый и имя заняты) */
		right: {
			type: Boolean,
			default: false,
		},
	},

	setup() {
		return { k4stats, WARN_TEXT }
	},

	computed: {
		s() {
			return k4stats.peers[this.peerId] ?? null
		},

		warns() {
			return this.s?.warn ?? []
		},

		worst() {
			return this.warns.some((w) => w.lvl === 'red') ? 'red' : this.warns.length ? 'yellow' : ''
		},

		kbpsText() {
			const s = this.s
			return s?.kbps == null ? DASH : (s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1).replace('.', ',') + ' Мбит/с' : Math.round(s.kbps) + ' кбит/с')
		},

		// узкая плитка: «1,2М · 3% · 80мс»
		shortLine() {
			const s = this.s
			const k = s?.kbps == null ? DASH : (s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1).replace('.', ',') + 'М' : Math.round(s.kbps) + 'к')
			return `${k} · ${s?.loss == null ? DASH : Math.round(s.loss) + '%'} · ${s?.rtt == null ? DASH : Math.round(s.rtt) + 'мс'}`
		},

		line() {
			const s = this.s
			const kbps = this.kbpsText
			const loss = s?.loss == null ? DASH : Math.round(s.loss) + '%'
			const rtt = s?.rtt == null ? DASH : Math.round(s.rtt) + ' мс'
			return `${kbps} · ${loss} · ${rtt}`
		},
	},
}
</script>

<style lang="scss" scoped>
.k4ts {
	position: absolute;
	z-index: 1;
	top: 4px;
	left: 4px;
	width: calc(100% - 48px); // справа/слева остаётся место под кнопку стикера и противоположный угол
	container-type: inline-size; // ширина фиксирована (не от содержимого), поэтому контейнер безопасен
	display: flex;
	flex-wrap: nowrap;
	gap: 4px;
	overflow: hidden;
	pointer-events: none;
	font-size: 11px;
	line-height: 16px;
	color: #fff;
}

.k4ts--right {
	left: auto;
	right: 4px;
	justify-content: flex-end;
}

.k4ts-short {
	display: none;
}

// плитка уже ~240 px: сжатый формат, всё помещается
@container (max-width: 190px) {
	.k4ts-full {
		display: none;
	}

	.k4ts-short {
		display: inline;
	}
}

.k4ts--compact {
	width: calc(100% - 8px);
	font-size: 10px;
}

.k4ts-line,
.k4ts-b {
	padding: 0 6px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.6);
	white-space: nowrap;
}

.k4ts-line {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.k4ts-b {
	flex: none;
}

.k4ts-turn {
	background: rgba(40, 90, 200, 0.85);
}

.k4ts-yellow {
	background: rgba(200, 150, 0, 0.9);
}

.k4ts-red {
	background: rgba(200, 30, 30, 0.9);
}
</style>
