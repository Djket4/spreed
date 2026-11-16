<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="local-video-control-wrapper">
		<NcButton
			:title="videoButtonTitle"
			:variant="videoStreamError ? 'error' : variant"
			:aria-label="videoButtonAriaLabel"
			:class="{
				'no-video-available': !isVideoAvailable,
				'video-control-button': showDevices,
			}"
			:disabled="resumeVideoAfterChange"
			@click.stop="toggleVideo">
			<template #icon>
				<IconVideo v-if="showVideoOn || resumeVideoAfterChange" :size="20" />
				<IconVideoOffOutline v-else :size="20" />
			</template>
		</NcButton>

		<NcActions
			v-if="showDevices"
			:disabled="!isVideoAvailable || !isVideoAllowed || !!videoStreamError"
			:aria-label="t('spreed', 'Video devices')"
			:title="t('spreed', 'Video devices')"
			class="video-selector-button"
			@open="updateDevices">
			<template #icon>
				<IconChevronUp :size="16" />
			</template>
			<!-- TRANSLATORS: Caption above the list of cameras (video devices) to select from -->
			<NcActionCaption :name="t('spreed', 'Camera')" />
			<NcActionButton
				v-for="device in videoDevices"
				:key="device.deviceId ?? 'none'"
				class="video-selector__action"
				type="radio"
				:modelValue="videoInputId"
				:value="device.deviceId"
				:title="device.label"
				@click="handleVideoInputIdChange(device.deviceId)">
				{{ device.label }}
			</NcActionButton>

			<NcActionSeparator />
			<NcActionButton
				key="media-settings"
				class="video-selector__action"
				closeAfterClick
				@click="emit('talk:media-settings:show')">
				{{ t('spreed', 'Check devices') }}
			</NcActionButton>
		</NcActions>

		<!-- ket4tec NAS_CLOUD#172: ошибка камеры — только по нажатию, плотная капсула у панели (не стопка уведомлений над «Ждём остальных») -->
		<Teleport to="body">
			<div
				v-if="k4CamMsg"
				class="k4-cam-toast"
				role="alert"
				:style="k4CamPos">
				{{ k4CamMsg }}
			</div>
		</Teleport>
	</div>
</template>

<script>
import { emit } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { useHotKey } from '@nextcloud/vue/composables/useHotKey'
import { ref } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconChevronUp from 'vue-material-design-icons/ChevronUp.vue'
import IconVideo from 'vue-material-design-icons/Video.vue' // Filled for better indication
import IconVideoOffOutline from 'vue-material-design-icons/VideoOffOutline.vue'
import { useDevices } from '../../../composables/useDevices.js'
import { PARTICIPANT } from '../../../constants.ts'

export default {
	name: 'LocalVideoControlButton',

	components: {
		NcActions,
		NcActionButton,
		NcActionCaption,
		NcActionSeparator,
		NcButton,
		IconChevronUp,
		IconVideo,
		IconVideoOffOutline,
	},

	props: {
		conversation: {
			type: Object,
			required: true,
		},

		model: {
			type: Object,
			required: true,
		},

		disableKeyboardShortcuts: {
			type: Boolean,
			default: OCP.Accessibility.disableKeyboardShortcuts(),
		},

		variant: {
			type: String,
			default: 'tertiary-no-background',
		},

		token: {
			type: String,
			required: true,
		},

		showDevices: {
			type: Boolean,
			default: false,
		},
	},

	setup(props) {
		const {
			devices,
			videoInputId,
			videoStreamError,
			updateDevices,
			updatePreferences,
			subscribeToDevices,
			unsubscribeFromDevices,
			updateSubscriptionPermissions,
		} = useDevices()

		/* Flag to smoothly toggle the video while in call */
		const resumeVideoAfterChange = ref(false)
		const k4CamMsg = ref('') // ket4tec NAS_CLOUD#172
		const k4CamPos = ref(null)

		return {
			devices,
			videoInputId,
			videoStreamError,
			updateDevices,
			updatePreferences,
			subscribeToDevices,
			unsubscribeFromDevices,
			updateSubscriptionPermissions,
			resumeVideoAfterChange,
			k4CamMsg,
			k4CamPos,
		}
	},

	computed: {
		isVideoAllowed() {
			return this.conversation.permissions & PARTICIPANT.PERMISSIONS.PUBLISH_VIDEO
		},

		isVideoAvailable() {
			return this.model.attributes.videoAvailable
		},

		showVideoOn() {
			return this.isVideoAvailable && this.model.attributes.videoEnabled
		},

		videoButtonTitle() {
			if (!this.isVideoAllowed) {
				return t('spreed', 'You are not allowed to enable video')
			}

			if (!this.isVideoAvailable) {
				return t('spreed', 'No video. Click to select device')
			}

			if (this.model.attributes.videoEnabled) {
				return this.disableKeyboardShortcuts
					? t('spreed', 'Disable video')
					: t('spreed', 'Disable video (V)')
			}

			if (!this.model.getWebRtc() || !this.model.getWebRtc().connection || this.model.getWebRtc().connection.getSendVideoIfAvailable()) {
				return this.disableKeyboardShortcuts
					? t('spreed', 'Enable video')
					: t('spreed', 'Enable video (V)')
			}

			return this.disableKeyboardShortcuts
				? t('spreed', 'Enable video - Your connection will be briefly interrupted when enabling the video for the first time')
				: t('spreed', 'Enable video (V) - Your connection will be briefly interrupted when enabling the video for the first time')
		},

		videoButtonAriaLabel() {
			if (!this.isVideoAvailable) {
				return t('spreed', 'No video. Click to select device')
			}

			if (this.model.attributes.videoEnabled) {
				return t('spreed', 'Disable video')
			}

			if (!this.model.getWebRtc() || !this.model.getWebRtc().connection || this.model.getWebRtc().connection.getSendVideoIfAvailable()) {
				return t('spreed', 'Enable video')
			}

			return t('spreed', 'Enable video. Your connection will be briefly interrupted when enabling the video for the first time')
		},

		videoDevices() {
			return [
				...this.devices.filter((device) => device.kind === 'videoinput')
					.map((device) => ({
						deviceId: device.deviceId,
						label: device.label || device.fallbackLabel,
					})),
				{ deviceId: null, label: t('spreed', 'None') },
			]
		},
	},

	watch: {
		isVideoAvailable(newValue) {
			if (newValue && this.resumeVideoAfterChange) {
				// New track is available, resume video
				this.model.enableVideo()
				this.resumeVideoAfterChange = false
			}
		},

		videoInputId(newValue) {
			if (!newValue && this.resumeVideoAfterChange) {
				this.resumeVideoAfterChange = false
			}
		},

		'conversation.permissions': function(newValue, oldValue) {
			this.updateSubscriptionPermissions(oldValue, newValue)
		},
	},

	created() {
		useHotKey('v', this.toggleVideo)
	},

	mounted() {
		this.subscribeToDevices(this.conversation.permissions, true) // ket4tec: пассивно, без своего getUserMedia (иначе второй запрос камеры при входе)
	},

	beforeUnmount() {
		clearTimeout(this.k4CamTimer)
		this.unsubscribeFromDevices(this.conversation.permissions, true)
	},

	methods: {
		t,
		emit,

		toggleVideo() {
			// ket4tec NAS_CLOUD#172: камера не открылась или её нет — говорим об этом по нажатию, вместо шторки проверки
			const err = this.model.attributes.localStreamRequestVideoError
			if (this.isVideoAllowed && !this.isVideoAvailable && (err || !this.devices.some((d) => d.kind === 'videoinput'))) {
				this.k4CamToast(!err
					? t('spreed', 'No camera available')
					: err.name === 'NotAllowedError'
						? t('spreed', 'Access to camera was denied')
						: ['NotReadableError', 'AbortError'].includes(err.name)
								? t('spreed', 'Error while accessing camera: It is likely in use by another program')
								: t('spreed', 'Error while accessing camera'))
				return
			}

			if (!this.isVideoAllowed || !this.isVideoAvailable) {
				emit('talk:media-settings:show')
				return
			}

			if (this.model.attributes.videoEnabled) {
				this.model.disableVideo()
			} else {
				this.model.enableVideo()
			}
		},

		k4CamToast(msg) {
			// поверх своей плитки сверху по центру, поля 12 (ничего не закрывает: «Вы» и кнопки плитки внизу); без плитки — у панели
			const tile = [...document.querySelectorAll('#call-container .localVideoContainer')].map((el) => el.getBoundingClientRect()).find((t) => t.width > 0 && t.height > 0)
			const r = this.$el.getBoundingClientRect()
			this.k4CamPos = tile
				? { top: (tile.top + 12) + 'px', left: (tile.left + tile.width / 2) + 'px', maxWidth: (tile.width - 24) + 'px' }
				: r.top > innerHeight / 2 ? { bottom: (innerHeight - r.top + 12) + 'px' } : { top: (r.bottom + 12) + 'px' }
			this.k4CamMsg = msg
			clearTimeout(this.k4CamTimer)
			this.k4CamTimer = setTimeout(() => {
				this.k4CamMsg = ''
			}, 4000)
		},

		handleVideoInputIdChange(videoInputId) {
			if (this.showDevices && this.showVideoOn) {
				// If input was changed from bottom bar while active, it should not be muted after track change
				this.resumeVideoAfterChange = true
			}
			this.videoInputId = videoInputId
			this.updatePreferences('videoinput')
		},

	},
}
</script>

<style scoped lang="scss">
.k4-cam-toast {
	position: fixed;
	left: 50%;
	z-index: 100000;
	transform: translateX(-50%);
	width: max-content;
	max-width: min(92vw, 520px);
	padding: 12px 20px;
	border-radius: 16px;
	background: var(--k7-dng, #e5453d); // красный, как «Положить трубку» (#172)
	color: #fff;
	font-size: 15px;
	font-weight: 600;
	line-height: 1.3;
	text-align: center;
	box-shadow: 0 10px 30px #0006;
}

.no-video-available {
	opacity: .7;
}

.video-selector-button :deep(.action-item__menutoggle) {
	--button-size: var(--clickable-area-small);
	height: var(--default-clickable-area);
	border-start-start-radius: 2px;
	border-end-start-radius: 2px;
}

.local-video-control-wrapper {
	display: flex;
	align-items: center;
	gap: 1px;

	// Overwriting NcButton styles
	.video-control-button {
		border-start-end-radius: 2px;
		border-end-end-radius: 2px;
	}
}

.video-selector__action {
	// Overwriting NcActionButton styles
	:deep(.action-button__longtext) {
		display: -webkit-box;
		-webkit-line-clamp: 1;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0;
		max-width: 350px;
	}

	:deep(.action-button__longtext-wrapper) {
		max-width: 350px;
	}

	:deep(.action-button__icon) {
		width: 0;
		margin-inline-start: calc(var(--default-grid-baseline) * 3);
	}

	:deep(.action-button > span) {
		height: var(--default-clickable-area);
	}
}
</style>
