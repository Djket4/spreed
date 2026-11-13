<!--
  - SPDX-FileCopyrightText: 2026 Ket4tec
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<!-- NAS_CLOUD#172, этап 2: правая половина кадра 2:1 — отдельная квадратная плитка с тем же потоком -->
	<Transition name="k4split" appear>
		<div class="video-container video-container-grid k4-split-tile" :class="{ speaking: isSpeaking, 'k4-nomic': model.attributes.audioAvailable === false }">
			<div class="videoWrapper">
				<video
					ref="video"
					class="video video--fill k4-half-r"
					:disablePictureInPicture="true" />
			</div>
			<VideoBottomBar
				hasShadow
				:participantName="participantName"
				:model="model"
				:sharedData="sharedData"
				:token="token" />
		</div>
	</Transition>
</template>

<script>
import VideoBottomBar from '../VideoBottomBar.vue'
import attachMediaStream from '../../../../utils/attachmediastream.js'

export default {
	name: 'K4SplitTile',
	components: { VideoBottomBar },
	props: {
		model: { type: Object, required: true },
		sharedData: { type: Object, required: true },
		token: { type: String, required: true },
		participantName: { type: String, default: '' },
	},

	computed: {
		isSpeaking() {
			return this.model.attributes.speaking
		},
	},

	watch: {
		'model.attributes.stream': function(stream) {
			this.attach(stream)
		},
	},

	mounted() {
		this.attach(this.model.attributes.stream)
	},

	methods: {
		attach(stream) {
			if (stream && this.$refs.video) {
				attachMediaStream(stream, this.$refs.video)
				this.$refs.video.muted = true
			}
		},
	},
}
</script>

<style lang="scss" scoped>
.k4-split-tile {
	position: relative;
	overflow: hidden;
	height: 100%;
	width: 100%;
	background: #000;
}

.k4-split-tile::after {
	content: '';
	position: absolute;
	inset: 0;
	pointer-events: none;
	border-radius: inherit;
}

.k4-split-tile.speaking::after {
	box-shadow: inset 0 0 0 2px white;
}

.k4split-enter-active,
.k4split-leave-active {
	transition: opacity .3s ease, transform .3s ease;
}

.k4split-enter-from,
.k4split-leave-to {
	opacity: 0;
	transform: scale(.4);
}
</style>
