<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div
		:id="screenContainerId"
		class="screenContainer"
		:class="{ 'k4-draw': k4state.mode }"
		:style="{ '--k4-pb': (instanceTransform.scale === 1 ? k4pb : 0) + 'px' }"
		@dblclick.capture="onDoubleClick">
		<video
			v-show="isLocalScreen || isRemoteScreen"
			ref="screen"
			:disablePictureInPicture="!isBig ? 'true' : 'false'"
			class="screen"
			:class="screenClass" />
		<!-- ket4tec: k4draw подключён — превью показывает настоящий кадр показа (как у собеседников), вместо заглушки строка -->
		<div v-if="isLocalScreen && mac.st === 'on'" class="k4-share-line" data-theme-dark>
			<span>Вы показываете экран — так его видят все</span>
			<NcButton variant="error" size="small" @click="stopLocalScreen">
				{{ t('spreed', 'Stop screensharing') }}
			</NcButton>
		</div>
		<NcEmptyContent
			v-else-if="isLocalScreen && showScreenPlaceholder"
			class="screen-placeholder"
			:name="t('spreed', 'You are sharing a screen')"
			:description="t('spreed', 'Sharing this window may cause a mirroring effect')"
			data-theme-dark>
			<template #icon>
				<IconMonitorScreenshot />
			</template>
			<template #action>
				<div class="screen-placeholder__actions">
					<NcButton variant="error" @click="stopLocalScreen">
						{{ t('spreed', 'Stop screensharing') }}
					</NcButton>
					<!-- ket4tec: k4draw. Приложение для Мака: пометки поверх всего экрана и пульт звонка -->
					<NcButton v-if="isMac()" variant="primary" @click="openMac()">
						{{ macLabel[mac.st] }}
					</NcButton>
					<NcButton variant="tertiary" @click="showScreenPlaceholder = false">
						{{ t('spreed', 'Dismiss') }}
					</NcButton>
				</div>
			</template>
		</NcEmptyContent>
		<!-- ket4tec: k4draw -->
		<DrawLayer
			v-if="isBig && k4Presenter && (isLocalScreen || isRemoteScreen) && !k4state.board"
			:presenter="k4Presenter"
			:video="screen"
			:transform="instanceTransform" />
		<VideoBottomBar
			v-if="isBig"
			:token="token"
			:sharedData="sharedData"
			isBig
			isScreen
			:model="model"
			:showVideoOverlay="showVideoOverlay"
			:participantName="remoteParticipantName" />
	</div>
</template>

<script>
import { t } from '@nextcloud/l10n'
import Hex from 'crypto-js/enc-hex.js'
import SHA1 from 'crypto-js/sha1.js'
import panzoom from 'panzoom'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import IconMonitorScreenshot from 'vue-material-design-icons/MonitorScreenshot.vue'
import DrawLayer from '../k4draw/DrawLayer.vue' // ket4tec: k4draw
import VideoBottomBar from './VideoBottomBar.vue'
import { useGuestNameStore } from '../../../stores/guestName.ts'
import attachMediaStream from '../../../utils/attachmediastream.js'
import { isMac, mac, macLabel, openMac } from '../k4draw/macBridge.js' // ket4tec: k4draw
import { bindLocalScreen, hasHpb, state as k4state, myId } from '../k4draw/useDrawing.js' // ket4tec: k4draw

const ZOOM_MIN = 1
const ZOOM_FACTOR = 4
const ZOOM_MAX = 8

export default {

	name: 'ScreenShare',

	components: {
		IconMonitorScreenshot,
		NcButton,
		NcEmptyContent,
		VideoBottomBar,
		DrawLayer, // ket4tec: k4draw
	},

	props: {
		token: {
			type: String,
			required: true,
		},

		localMediaModel: {
			type: Object,
			default: null,
		},

		callParticipantModel: {
			type: Object,
			default: null,
		},

		sharedData: {
			type: Object,
			required: true,
		},

		isBig: {
			type: Boolean,
			default: false,
		},

		showVideoOverlay: {
			type: Boolean,
			default: true,
		},
	},

	setup(props) {
		const guestNameStore = useGuestNameStore()

		const screen = ref(null)
		const instance = ref(null)
		const instanceTransform = ref({ x: 0, y: 0, scale: 1 })
		const instanceGrabbing = ref(false)

		/* Flags and utilities to track, if we need to prevent mirroring effect */
		const showScreenPlaceholder = ref(false)
		const isLocalScreen = computed(() => props.localMediaModel && props.localMediaModel.attributes.localScreen)
		const isRemoteScreen = computed(() => props.callParticipantModel && props.callParticipantModel.attributes.screen)

		const screenClass = computed(() => {
			if (!props.isBig) {
				return ['screen--fill']
			} else {
				return [
					'screen--fit',
					instanceTransform.value.scale === 1
						? 'screen--magnify'
						: (instanceGrabbing.value ? 'screen--grabbing' : 'screen--grab'),
				]
			}
		})

		// ket4tec: k4draw. Показывающий объявляет ключ показа; слой рисует по sessionId показывающего.
		const k4Presenter = computed(() => {
			if (!hasHpb()) {
				return null
			}
			return isLocalScreen.value ? myId() : props.callParticipantModel?.attributes.peerId || null
		})
		// жизнь показа привязана к модели локального экрана, не к экземпляру: закрепление камеры размонтирует компонент
		props.localMediaModel && bindLocalScreen(props.localMediaModel)
		// ket4tec: k4draw (NAS_CLOUD#108). В режиме рисования зум остаётся: один палец/мышь/перо — штрих,
		// два пальца — зум и сдвиг показа. Слой рисования повторяет transform видео, штрихи в координатах кадра.
		// Одиночное касание не отдаём panzoom (иначе палец двигает картинку), второй палец — отдаём (щипок).
		let k4mid = null
		const k4touchStart = (e) => {
			k4mid = null
			if (k4state.mode && e.touches.length === 1) {
				e.stopImmediatePropagation()
			}
		}
		// panzoom щипком только масштабирует вокруг середины; сдвиг двумя пальцами добавляем сами
		const k4touchMove = (e) => {
			if (!k4state.mode || e.touches.length !== 2 || !instance.value) {
				k4mid = null
				return
			}
			const [a, b] = e.touches
			const m = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
			if (k4mid) {
				instance.value.moveBy(m.x - k4mid.x, m.y - k4mid.y, false)
			}
			k4mid = m
		}

		// ket4tec (NAS_CLOUD#109 п.7): экран вписан с полями (портрет телефона) — подпись стоит у нижнего края картинки, не контейнера
		const k4pb = ref(0)
		const k4fit = () => {
			const v = screen.value
			k4pb.value = v?.videoWidth ? Math.max(0, Math.round((v.clientHeight - v.clientWidth * v.videoHeight / v.videoWidth) / 2)) : 0
		}
		const k4ro = new ResizeObserver(k4fit)

		onMounted(() => {
			if (props.isBig) {
				k4ro.observe(screen.value)
				screen.value.addEventListener('resize', k4fit) // смена размера самого потока

				instance.value = panzoom(screen.value, {
					minZoom: ZOOM_MIN,
					maxZoom: ZOOM_MAX,
					bounds: true,
					boundsPadding: 1,
					beforeMouseDown: () => k4state.mode, // ket4tec: k4draw — мышь в режиме рисования рисует, колесо зумит
				})
				// ket4tec: k4draw — capture раньше слушателя panzoom на том же контейнере
				const c = screen.value.parentElement
				c.addEventListener('touchstart', k4touchStart, { capture: true, passive: true })
				c.addEventListener('touchmove', k4touchMove, { capture: true, passive: true })
				instance.value.on('transform', (instance) => {
					instanceTransform.value = { ...instance.getTransform() }
				})
				instance.value.on('panstart', () => {
					instanceGrabbing.value = true
				})
				instance.value.on('panend', () => {
					instanceGrabbing.value = false
				})
			}
		})
		onBeforeUnmount(() => {
			instance.value?.dispose()
			k4ro.disconnect()
		})

		/**
		 * Overriding method to handle double click event on screen share
		 *
		 * @param event Double click event
		 */
		function onDoubleClick(event) {
			if (!instance.value) {
				return
			}
			if (k4state.mode) { // ket4tec: k4draw — двойное касание при рисовании не зумит
				event.stopPropagation()
				return
			}

			// panzoom library puts a listener on parent element
			event.preventDefault()
			event.stopPropagation()

			// Calculate the offset of the click event from the top left corner of screen container
			const screenContainerRect = event.currentTarget.getBoundingClientRect()
			const offsetX = event.clientX - screenContainerRect.left
			const offsetY = event.clientY - screenContainerRect.top

			if (instanceTransform.value.scale === 1) {
				// Zoom in the click point with specified zoom factor
				instance.value.smoothZoom(offsetX, offsetY, ZOOM_FACTOR)
			} else {
				// Zoom out (0 is set to ensure the zoom is reset to 1)
				instance.value.smoothZoomAbs(offsetX, offsetY, 0)
			}
		}

		return {
			isMac, // ket4tec: k4draw
			mac,
			macLabel,
			openMac,
			guestNameStore,
			screen,
			k4pb,
			k4Presenter,
			k4state,
			instanceTransform,
			screenClass,
			onDoubleClick,
			// Mirror fix
			showScreenPlaceholder,
			isLocalScreen,
			isRemoteScreen,
		}
	},

	computed: {
		model() {
			if (this.callParticipantModel) {
				return this.callParticipantModel
			}
			return this.localMediaModel
		},

		screenContainerId() {
			if (this.localMediaModel) {
				return 'localScreenContainer'
			}

			return 'container_' + this.callParticipantModel.attributes.peerId + '_screen_incoming'
		},

		remoteSessionHash() {
			if (!this.callParticipantModel) {
				return null
			}

			return Hex.stringify(SHA1(this.callParticipantModel.attributes.nextcloudSessionId))
		},

		remoteParticipantName() {
			if (!this.callParticipantModel) {
				return t('spreed', 'You')
			}

			let remoteParticipantName = this.callParticipantModel.attributes.name

			// The name is undefined and not shown until a connection is made
			// for registered users, so do not fall back to the guest name in
			// the store either until the connection was made.
			if (!this.callParticipantModel.attributes.userId && !remoteParticipantName && remoteParticipantName !== undefined) {
				remoteParticipantName = this.guestNameStore.getGuestName(
					this.token,
					this.remoteSessionHash,
				)
			}

			return remoteParticipantName
		},
	},

	watch: {

		'localMediaModel.attributes.localScreen': function(localScreen) {
			this._setScreen(localScreen)
		},

		'callParticipantModel.attributes.screen': function(screen) {
			this._setScreen(screen)
		},

	},

	mounted() {
		// Set initial state
		if (this.localMediaModel) {
			this._setScreen(this.localMediaModel.attributes.localScreen)
		} else {
			this._setScreen(this.callParticipantModel.attributes.screen)
		}
	},

	methods: {
		t,

		_setScreen(screen) {
			if (!screen) {
				this.$refs.screen.srcObject = null

				return
			}

			// The audio is played using an audio element in the model to be
			// able to hear it even if there is no view for it.
			attachMediaStream(screen, this.$refs.screen)

			// Modern browsers prevent streaming own tab and switching to it later.
			// Guard is against 'window', 'monitor', undefined (unsupported in Safari/Firefox)
			if (this.isLocalScreen) {
				if (screen.getVideoTracks?.()[0]?.getSettings?.().displaySurface === 'browser') {
					// Chromium only, if tab (not self) from current browser is shared - no mirroring
					this.showScreenPlaceholder = false
				} else {
					this.showScreenPlaceholder = true
				}
			}

			this.$refs.screen.muted = true
		},

		stopLocalScreen() {
			this.localMediaModel.stopSharingScreen()
		},
	},

}
</script>

<style lang="scss" scoped>
.screenContainer {
	width: 100%;
	height: 100%;
}

// ket4tec: k4draw (NAS_CLOUD#108) — жесты над всем показом (и полями вокруг кадра) ведёт код, не браузер, как у доски
.screenContainer.k4-draw {
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

.screen {
	width: 100%;
	height: 100%;
	position: absolute;
	top: 0;
	inset-inline-start: 0;
	&--fit {
		object-fit: contain;
	}
	&--fill {
		object-fit: cover;
	}
	&--magnify {
		cursor: zoom-in;
	}
	&--grab {
		cursor: grab;
	}
	&--grabbing {
		cursor: grabbing;
	}
}

.k4-share-line {
	position: absolute;
	top: calc(var(--default-grid-baseline) * 2);
	inset-inline-start: 50%;
	transform: translateX(-50%);
	z-index: 3;
	display: flex;
	align-items: center;
	gap: calc(var(--default-grid-baseline) * 2);
	padding: var(--default-grid-baseline) var(--default-grid-baseline) var(--default-grid-baseline) calc(var(--default-grid-baseline) * 3);
	border-radius: var(--border-radius-pill);
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	font-size: 13px;
	white-space: nowrap;
}

.screen-placeholder {
	width: 100%;
	height: 100%;
	position: absolute;
	inset: 0;
	color: var(--color-main-text);
	background-color: rgba(var(--color-main-background-rgb), 0.95);

	&__actions {
		display: flex;
		gap: var(--default-grid-baseline);
	}

	// ket4tec: плашка показывающего крупно и строго по центру области показа (проба владельца)
	&:deep(.empty-content) {
		justify-content: center;
		margin: 0;
		padding: 24px;
	}

	&:deep(.empty-content__icon), &:deep(.empty-content__icon svg) {
		width: 80px !important;
		height: 80px !important;
		max-width: 80px !important;
		max-height: 80px !important;
	}

	&:deep(.empty-content__name) {
		font-size: 24px;
		line-height: 32px;
		margin-bottom: 8px;
	}

	&:deep(.empty-content__description) {
		font-size: 16px;
		line-height: 22px;
	}

	&:deep(.empty-content__action) {
		margin-top: 24px;
	}

	&__actions {
		gap: 12px;
		flex-wrap: wrap;
		justify-content: center;

		:deep(.button-vue) {
			min-height: 48px;
			padding-inline: 24px;
			border-radius: 10px;
			font-size: 16px;
		}

		// красный как у «Покинуть вызов»: тема гасит error-кнопки
		:deep(.button-vue--error) {
			background-color: #c92c4c !important;
			border-color: #c92c4c !important;
			color: #fff !important;
		}
	}
}

</style>
