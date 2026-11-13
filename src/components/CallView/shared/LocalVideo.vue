<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div
		ref="videoContainer"
		class="localVideoContainer"
		:class="[videoContainerClass, { 'k4stk-has': k4stkOn }]"
		@mouseover="mouseover = true"
		@mouseleave="mouseover = false"
		@click="$emit('clickVideo', $event)">
		<img
			v-if="screenshotModeUrl"
			class="dev-mode-video--self videoWrapper"
			alt="dev-mode-video--self"
			:src="screenshotModeUrl">

		<div
			v-show="!screenshotModeUrl && localMediaModel.attributes.videoEnabled"
			class="videoWrapper"
			:style="videoWrapperStyle">
			<video
				id="localVideo"
				ref="video"
				disablePictureInPicture="true"
				:class="[fitVideo ? 'video--fit' : 'video--fill', { 'k4-two-own': k4two }]"
				class="video"
				@resize="k4Resize"
				@playing="updateVideoAspectRatio" />
			<IconAccountOffOutline
				v-if="isPresenterOverlay && mouseover"
				class="presenter-icon__hide"
				:aria-label="t('spreed', 'Hide presenter video')"
				:title="t('spreed', 'Hide presenter video')"
				:size="32"
				@click="$emit('clickPresenter')" />
			<NcLoadingIcon
				v-if="isNotConnected"
				:size="avatarSize / 2"
				class="video-loading" />
		</div>
		<div v-if="!screenshotModeUrl && !localMediaModel.attributes.videoEnabled && !isSidebar" class="avatar-container">
			<VideoBackground v-if="isGrid || isStripe" />
			<!-- ket4tec: облако во всех видах (сетка, полоса, докладчик, крупно), не только в сетке -->
			<K4Face
				:stream="localMediaModel.attributes.localStream"
				:on="!!localMediaModel.attributes.audioEnabled"
				:seed="actorStore.actorId ? actorStore.actorType + '/' + actorStore.actorId : (displayName || '?')"
				:token="token" />
		</div>

		<!-- ket4tec: k4stk -->
		<TileSticker :on="k4stkOn" own />
		<K4TileStats peerId="local" />
		<!-- ket4tec: своя связь пропала после подключения -->
		<K4Reconnect v-if="k4WasConn && isNotConnected && !isSidebar" title="Нет связи" sub="переподключаемся…" />

		<div class="bottom-bar">
			<!-- ket4tec: подпись своей плитки, видна и поверх стикера/гифки -->
			<span v-if="!isSidebar && !isBig && !isPresenterOverlay && (isGrid || isStripe)" class="participant-name k7-self">Вы</span>
			<NcButton
				v-if="isBig"
				variant="tertiary"
				class="bottom-bar__button"
				@click="handleStopFollowing">
				{{ stopFollowingLabel }}
			</NcButton>
		</div>
	</div>
</template>

<script>
import { showError, showInfo } from '@nextcloud/dialogs'
import { emit } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { inject, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import IconAccountOffOutline from 'vue-material-design-icons/AccountOffOutline.vue'
import K4TileStats from '../k4log/K4TileStats.vue' // ket4tec
import TileSticker from '../k4stk/TileSticker.vue' // ket4tec: k4stk
import K4Face from './k4face/K4Face.vue' // ket4tec
import K4Reconnect from './K4Reconnect.vue' // ket4tec
import VideoBackground from './VideoBackground.vue'
import { AVATAR } from '../../../constants.ts'
import { useActorStore } from '../../../stores/actor.ts'
import { useCallViewStore } from '../../../stores/callView.ts'
import attachMediaStream from '../../../utils/attachmediastream.js'
import { isTwoSquares } from '../../../utils/media/pipeline/FaceSquare.js'
import { ConnectionState } from '../../../utils/webrtc/models/CallParticipantModel.js'
import { placeholderImage } from '../Grid/gridPlaceholders.ts'
import { state as k4stk } from '../k4stk/useStickers.js' // ket4tec: k4stk

export default {

	name: 'LocalVideo',

	components: {
		K4Face,
		IconAccountOffOutline,
		NcButton,
		VideoBackground,
		NcLoadingIcon,
		K4Reconnect,
		K4TileStats,
		TileSticker,
	},

	props: {
		token: {
			type: String,
			required: true,
		},

		localMediaModel: {
			type: Object,
			required: true,
		},

		localCallParticipantModel: {
			type: Object,
			required: true,
		},

		isGrid: {
			type: Boolean,
			default: false,
		},

		isStripe: {
			type: Boolean,
			default: false,
		},

		fitVideo: {
			type: Boolean,
			default: false,
		},

		isSidebar: {
			type: Boolean,
			default: false,
		},

		unSelectable: {
			type: Boolean,
			default: false,
		},

		isBig: {
			type: Boolean,
			default: false,
		},

		isSmall: {
			type: Boolean,
			default: false,
		},

		isPresenterOverlay: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['clickVideo', 'clickPresenter'],

	setup() {
		const devMode = inject('CallView:devModeEnabled', ref(false))
		const screenshotMode = inject('CallView:screenshotModeEnabled', ref(false))

		return {
			devMode,
			screenshotMode,
			callViewStore: useCallViewStore(),
			actorStore: useActorStore(),
		}
	},

	data() {
		return {
			notificationHandle: null,
			k4two: false, // кадр 2:1 (два квадрата, #172 этап 2): свою плитку показываем целиком
			videoAspectRatio: null,
			containerAspectRatio: null,
			resizeObserver: null,
			mouseover: false,
			k4WasConn: false, // ket4tec
		}
	},

	computed: {
		// ket4tec: k4stk. Моя гифка/стикер вместо камеры (не в боковой панели)
		k4stkOn() {
			return !!k4stk.mine && !this.isSidebar
		},

		stopFollowingLabel() {
			return t('spreed', 'Back')
		},

		isNotConnected() {
			// When there is no sender participant (when the MCU is not used, or
			// if it is used but no peer object has been set yet) the local
			// video is shown as connected.
			return this.localCallParticipantModel.attributes.peerNeeded
				&& this.localCallParticipantModel.attributes.connectionState !== ConnectionState.CONNECTED && this.localCallParticipantModel.attributes.connectionState !== ConnectionState.COMPLETED
		},

		videoContainerClass() {
			return {
				'not-connected': this.isNotConnected,
				'video-container-grid': this.isGrid,
				'video-container-big': this.isBig,
				'video-container-small': this.isSmall,
				presenter: this.isPresenterOverlay && this.mouseover,
				'presenter-overlay': this.isPresenterOverlay,
				'hover-shadow': this.isSelectable && this.mouseover,
				speaking: this.localMediaModel.attributes.speaking,
				'k4-nomic': !this.localMediaModel.attributes.audioEnabled && !this.isBig, // ket4tec: красная рамка «микрофон выключен»
			}
		},

		videoWrapperStyle() {
			if (!this.containerAspectRatio || !this.videoAspectRatio || !this.isBig || this.isGrid) {
				return
			}
			return (this.containerAspectRatio > this.videoAspectRatio)
				? `width: ${this.$refs.videoContainer.clientHeight * this.videoAspectRatio}px`
				: `height: ${this.$refs.videoContainer.clientWidth / this.videoAspectRatio}px`
		},

		userId() {
			return this.actorStore.userId
		},

		displayName() {
			return this.actorStore.displayName
		},

		avatarSize() {
			if (!this.isBig && !this.isGrid) {
				return AVATAR.SIZE.LARGE
			} else if (!this.containerAspectRatio) {
				return AVATAR.SIZE.FULL
			} else {
				return Math.min(AVATAR.SIZE.FULL, this.$refs.videoContainer.clientHeight / 2, this.$refs.videoContainer.clientWidth / 2)
			}
		},

		localStreamVideoError() {
			return this.localMediaModel.attributes.localStream && this.localMediaModel.attributes.localStreamRequestVideoError
		},

		hasLocalVideo() {
			return this.localMediaModel.attributes.videoEnabled
		},

		isSelected() {
			return this.callViewStore.selectedVideoPeerId === 'local'
		},

		isSelectable() {
			return !this.unSelectable && !this.isSidebar && this.hasLocalVideo && this.callViewStore.selectedVideoPeerId !== 'local'
		},

		screenshotModeUrl() {
			return this.screenshotMode ? placeholderImage(8) : ''
		},
	},

	watch: {
		// ket4tec: плашку обрыва показываем только после первого подключения
		isNotConnected: {
			immediate: true,
			handler(v) {
				if (!v) {
					this.k4WasConn = true
				}
			},
		},

		localCallParticipantModel: {
			immediate: true,

			handler(localCallParticipantModel, oldLocalCallParticipantModel) {
				if (oldLocalCallParticipantModel) {
					oldLocalCallParticipantModel.off('forcedMute', this._handleForcedMute)
				}

				if (localCallParticipantModel) {
					localCallParticipantModel.on('forcedMute', this._handleForcedMute)
				}
			},
		},

		'localMediaModel.attributes.localStream': function(localStream) {
			this._setLocalStream(localStream)
		},

		localStreamVideoError: {
			immediate: true,
			handler(error) {
				if (error) {
					if (error.name === 'NotAllowedError') {
						this.notificationHandle = showError(t('spreed', 'Access to camera was denied'))
					} else if (error.name === 'NotReadableError' || error.name === 'AbortError') {
						// when camera in use, Chrome gives NotReadableError, Firefox gives AbortError
						this.notificationHandle = showError(t('spreed', 'Error while accessing camera: It is likely in use by another program'), {
							timeout: 5000,
						})
					} else {
						console.error('Error while accessing camera: ', error.message, error.name)
						this.notificationHandle = showError(t('spreed', 'Error while accessing camera'), {
							timeout: 5000,
						})
					}
				}
			},
		},

	},

	mounted() {
		// Set initial state
		this._setLocalStream(this.localMediaModel.attributes.localStream)

		if (this.isBig || this.isGrid) {
			this.resizeObserver = new ResizeObserver(this.updateContainerAspectRatio)
			this.resizeObserver.observe(this.$refs.videoContainer)
		}
	},

	beforeUnmount() {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect()
		}
	},

	unmounted() {
		if (this.notificationHandle) {
			this.notificationHandle.hideToast()
		}
		if (this.localCallParticipantModel) {
			this.localCallParticipantModel.off('forcedMute', this._handleForcedMute)
		}
	},

	methods: {
		k4Resize() {
			const v = this.$refs.video
			this.k4two = !!v && isTwoSquares(v.videoWidth, v.videoHeight)
		},

		t,
		_handleForcedMute() {
			// The default toast selector is "body-user", but as this toast can
			// be shown to guests too, a generic selector valid both for logged-in
			// users and guests needs to be used instead (undefined selects
			// the body element).
			showInfo(t('spreed', 'You have been muted by a moderator'), { selector: undefined })
		},

		_setLocalStream(localStream) {
			if (!localStream) {
				// Do not clear the srcObject of the video element, just leave
				// the previous stream as a frozen image.

				return
			}

			const options = {
				autoplay: true,
				mirror: true,
				muted: true,
			}
			attachMediaStream(localStream, this.$refs.video, options)
		},

		handleStopFollowing() {
			emit('k4-unpin-video') // ket4tec (NAS_CLOUD#153): единый путь в CallView
		},

		updateContainerAspectRatio([{ target }]) {
			this.containerAspectRatio = target.clientWidth / target.clientHeight
		},

		updateVideoAspectRatio() {
			if (!this.isBig) {
				return
			}
			this.videoAspectRatio = this.localMediaModel.attributes.localStream.getVideoTracks()?.[0].getSettings().aspectRatio
				// Fallback for Firefox
				?? this.$refs.video.videoWidth / this.$refs.video.videoHeight
		},
	},

}
</script>

<style lang="scss" scoped>
.not-connected {
	video,
	.avatar-container {
		opacity: 0.5;
	}
}

.localVideoContainer {
	border-radius: var(--border-radius-element, calc(var(--default-clickable-area) / 2));
	overflow: hidden;
	z-index: 1;
}

.video-container-grid {
	position: relative;
	height: 100%;
	width: 100%;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.video-container-big {
	position: absolute;
	width: calc(100% - var(--grid-gap) * 2);
	height: 100%;
	display: flex;
	flex-direction: column;

	& .videoWrapper {
		margin: auto;
	}
}

.video-container-small {
	border-radius: var(--border-radius-large);
}

.videoWrapper,
.video {
	height: 100%;
	width: 100%;
}

.video-loading {
	position: absolute;
	top: 0;
	inset-inline-end: 0;
	height: 100%;
	width: 100%;
}

.video--fit {
	/* Fit the frame */
	object-fit: contain;
}

.video--fill {
	/* Fill the frame */
	object-fit: cover;
}

.avatar-container {
	margin: auto;
}

.presenter-overlay,
.presenter-overlay * {
	border-radius: 50%;
}

.localVideoContainer::after {
	position: absolute;
	height: 100%;
	width: 100%;
	top: 0;
	inset-inline-start: 0;
	border-radius: var(--border-radius-element, calc(var(--default-clickable-area) / 2));
}

.presenter-overlay::after {
	border-radius: 50%;
	z-index: 1;
}

.hover-shadow::after {
	content: '';
	box-shadow: inset 0 0 0 3px white;
	cursor: pointer;
}

.speaking::after {
	content: '';
	box-shadow: inset 0 0 0 2px white;
}

.bottom-bar {
	position: absolute;
	z-index: 1; // ket4tec: над TileSticker
	bottom: 0;
	width: 100%;
	padding: 0 calc(var(--default-grid-baseline) * 3);
	padding-bottom: calc(var(--default-grid-baseline) * 2);
	display: flex;
	justify-content: center;
	align-items: center;

	&--big {
		justify-content: center;
	}

	// ket4tec: вид подписи — общий с чужими плитками («нижняя треть», k7call.scss)
	.k7-self { margin-inline: 0 auto; }

	& &__button {
		opacity: 0.8;
		background-color: var(--color-background-dark);

		&:hover,
		&:focus {
			opacity: 1;
		}
	}
}

.dev-mode-video--self {
	object-fit: cover !important;
	border-radius: var(--border-radius-element, calc(var(--default-clickable-area) / 2));

	.presenter-overlay & {
		border-radius: 50%;
	}
}

.presenter-icon__hide {
	position: absolute;
	color: white;
	inset-inline-start: calc(50% - var(--default-clickable-area) / 2);
	top: calc(100% - var(--default-grid-baseline) - var(--default-clickable-area));
	opacity: 0.7;
	background-color: rgba(0, 0, 0, 0.5);
	border-radius: 50%;
	padding: 6px;
	width: var(--default-clickable-area);
	height: var(--default-clickable-area);
	z-index: 2; // Above video and its border

	&:hover {
		cursor: pointer;
		opacity: 0.9;
	}

}
</style>
