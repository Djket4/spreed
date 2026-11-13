<!--
  - ket4tec: журнал звонка (NAS_CLOUD#189). Цифры связи и предупреждения поверх плитки, только в тест-режиме владельца.
-->

<template>
	<div v-if="k4stats.testmode" class="k4ts" data-k4ts>
		<span class="k4ts-line">{{ line }}</span>
		<span v-if="s && s.path === 'relay'" class="k4ts-b k4ts-turn">TURN</span>
		<span
			v-for="w in warns"
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

		line() {
			const s = this.s
			const kbps = s?.kbps == null ? DASH : (s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1).replace('.', ',') + ' Мбит/с' : Math.round(s.kbps) + ' кбит/с')
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
	right: 4px;
	display: flex;
	flex-wrap: nowrap;
	gap: 4px;
	overflow: hidden;
	pointer-events: none;
	font-size: 11px;
	line-height: 16px;
	color: #fff;
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
