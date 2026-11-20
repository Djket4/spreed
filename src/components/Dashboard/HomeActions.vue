<!--
  - SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<!-- ket4tec (NAS_CLOUD#332): четыре кнопки главной «Звонков» + окно новой встречи (вынесено из убранной панели Talk) -->
<script lang="ts" setup>
import { getRequestToken } from '@nextcloud/auth'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { emit } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconCheck from 'vue-material-design-icons/Check.vue'
import IconClose from 'vue-material-design-icons/Close.vue'
import IconMicrophoneOutline from 'vue-material-design-icons/MicrophoneOutline.vue'
import IconPhoneOutline from 'vue-material-design-icons/PhoneOutline.vue'
import IconPlus from 'vue-material-design-icons/Plus.vue'
import IconVideoOutline from 'vue-material-design-icons/VideoOutline.vue'
import { CONVERSATION } from '../../constants.ts'
import { getTalkConfig } from '../../services/CapabilitiesManager.ts'
import { EventBus } from '../../services/EventBus.ts'
import { convertToUnix } from '../../utils/formattedTime.ts'
import generatePassword from '../../utils/generatePassword.ts'
import { generateFullConversationLink } from '../../utils/handleUrl.ts'

const store = useStore()
const router = useRouter()
const isMobile = useIsMobile()
const isCallEnabled = getTalkConfig('local', 'call', 'enabled')
const canStartConversations = getTalkConfig('local', 'conversations', 'can-create')
const forcePasswordProtection = getTalkConfig('local', 'conversations', 'force-passwords')
const conversationName = ref('')

const meetingOpen = ref(false)
const meetingBusy = ref(false)
let meetingGen = 0 // ket4tec (NAS_CLOUD#110 Б6): номер открытия формы — ответ прошлого открытия её не заполняет
const meetingToken = ref('')
const meetingLink = ref('')
const meetingPassword = ref('')
// 'copied' | 'ready' (clipboard write failed: user has to tap "Copy")
const meetingCopyState = ref<'copied' | 'ready'>('copied')
const meetingInput = ref<HTMLInputElement | null>(null)

// ket4tec: «Мой звонок» — постоянная ссылка на личную открытую беседу «Личные переговоры» (NAS_CLOUD#100).
// Ссылку выдаёт приложение «Стол» (/apps/ket4tec_launchpad/api/links, создаёт беседу при первом обращении); нет приложения — нет кнопки.
// Берём заранее: iOS Safari пускает «Поделиться» и буфер только прямо в обработчике нажатия.
const myCallLink = ref('')
fetch(generateUrl('/apps/ket4tec_launchpad/api/links'), { headers: { Accept: 'application/json', requesttoken: getRequestToken() ?? '' } })
	.then((r) => (r.ok ? r.json() : null))
	.then((d) => { myCallLink.value = d?.call || '' })
	.catch(() => {})

/**
 * Телефон — системное «Поделиться», компьютер (или «Поделиться» нет) — ссылка в буфер.
 */
function shareMyCall() {
	const url = myCallLink.value
	if (navigator.share && (isMobile.value || matchMedia('(pointer: coarse)').matches)) {
		navigator.share({ title: t('spreed', 'Personal call'), url }).catch((e) => {
			if (e?.name !== 'AbortError') {
				copyMyCall(url)
			}
		})
		return
	}
	copyMyCall(url)
}

/**
 * @param url ссылка на беседу
 */
function copyMyCall(url: string) {
	navigator.clipboard.writeText(url).then(() => showSuccess(t('spreed', 'Link copied')), () => showError(t('spreed', 'The link could not be copied')))
}

/**
 * Opens the "new meeting" window with an empty form.
 */
async function openMeeting() {
	meetingGen++
	conversationName.value = ''
	meetingToken.value = ''
	meetingOpen.value = true
	await nextTick()
	meetingInput.value?.focus()
}

/**
 * Closes the "new meeting" window (a created conversation stays in the list).
 */
function closeMeeting() {
	meetingOpen.value = false
}

/**
 * Text that goes to the clipboard: the link and, if forced, the password.
 */
function meetingClipboardText() {
	return meetingPassword.value
		? meetingLink.value + '\n' + t('spreed', 'Password: {password}', { password: meetingPassword.value }, { escape: false, sanitize: false })
		: meetingLink.value
}

/**
 * Copies the link again (user gesture, so plain writeText works everywhere).
 */
async function copyMeetingAgain() {
	try {
		await navigator.clipboard.writeText(meetingClipboardText())
		meetingCopyState.value = 'copied'
	} catch {
		showError(t('spreed', 'The link could not be copied'))
	}
}

/**
 * Creates the instant meeting conversation and copies its link, without joining the call.
 * The clipboard write starts synchronously in the click handler (iOS Safari drops the user gesture
 * after the first network await), its content is a promise resolved once the conversation exists.
 */
async function startMeeting() {
	if (meetingBusy.value) {
		return
	}
	meetingBusy.value = true
	const gen = meetingGen
	let resolveText!: (text: string) => void
	let rejectText!: (error: unknown) => void
	const textPromise = new Promise<string>((resolve, reject) => {
		resolveText = resolve
		rejectText = reject
	})
	textPromise.catch(() => {}) // без ClipboardItem обработчика нет — не плодим unhandledrejection
	let clipboardWrite: Promise<void> | null = null
	try {
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
			clipboardWrite = navigator.clipboard.write([
				new ClipboardItem({ 'text/plain': textPromise.then((text) => new Blob([text], { type: 'text/plain' })) }),
			])
			// handled below, avoid an unhandled rejection if creation fails first
			clipboardWrite.catch(() => {})
		}
	} catch {
		clipboardWrite = null
	}

	try {
		const password = forcePasswordProtection ? await generatePassword() : undefined
		const conversation = await store.dispatch('createGroupConversation', {
			// TRANSLATORS: Section header for meeting-related settings; also a static name fallback for instant meeting conversation
			roomName: conversationName.value.trim() || t('spreed', 'Meeting'),
			roomType: CONVERSATION.TYPE.PUBLIC,
			objectType: CONVERSATION.OBJECT_TYPE.INSTANT_MEETING,
			objectId: convertToUnix(new Date()).toString(),
			password,
		})
		if (gen !== meetingGen) {
			rejectText(new Error('stale'))
			return
		}
		meetingToken.value = conversation.token
		meetingLink.value = generateFullConversationLink(conversation.token)
		meetingPassword.value = password ?? ''
		resolveText(meetingClipboardText())
		try {
			await clipboardWrite
			meetingCopyState.value = clipboardWrite ? 'copied' : 'ready'
		} catch {
			meetingCopyState.value = 'ready'
		}
	} catch (error) {
		rejectText(error)
		console.error('Error creating conversation:', error)
		showError(t('spreed', 'Error while creating the conversation'))
	} finally {
		meetingBusy.value = false
	}
}

/**
 * Goes to the created meeting and starts the call.
 */
async function joinMeeting() {
	const token = meetingToken.value
	closeMeeting()
	await router.push({
		name: 'conversation',
		params: { token },
		hash: '#direct-call',
	})
}
</script>

<template>
	<div class="talk-dashboard__actions">
		<NcButton
			v-if="canStartConversations && isCallEnabled"
			class="talk-dashboard__action"
			variant="primary"
			@click="openMeeting">
			<template #icon>
				<IconVideoOutline />
			</template>
			{{ t('spreed', 'Start meeting') }}
		</NcButton>
		<NcButton
			v-if="myCallLink && isCallEnabled"
			class="talk-dashboard__action k7-mycall"
			variant="secondary"
			:title="t('spreed', 'Permanent link to your personal call')"
			@click="shareMyCall">
			<template #icon>
				<IconPhoneOutline :size="20" />
			</template>
			{{ t('spreed', 'My call link') }}
		</NcButton>
		<NcButton
			v-if="canStartConversations"
			class="talk-dashboard__action"
			:aria-label="t('spreed', 'New conversation')"
			:title="t('spreed', 'New conversation')"
			@click="EventBus.emit('new-conversation-dialog:show')">
			<template #icon>
				<IconPlus :size="20" />
			</template>
			{{ isMobile ? t('spreed', 'Conversation') : t('spreed', 'New conversation') }}
		</NcButton>
		<NcButton
			v-if="isCallEnabled"
			class="talk-dashboard__action"
			variant="secondary"
			:aria-label="t('spreed', 'Check devices')"
			:title="t('spreed', 'Check devices')"
			@click="emit('talk:media-settings:show', 'device-check')">
			<template #icon>
				<IconMicrophoneOutline :size="20" />
			</template>
			{{ isMobile ? t('spreed', 'Check') : t('spreed', 'Check devices') }}
		</NcButton>
	</div>
	<Teleport to="body">
		<div
			v-if="meetingOpen"
			class="k7-meet"
			@keydown.esc.stop="closeMeeting">
			<div class="k7-meet__scrim" @click="closeMeeting" />
			<div
				class="k7-meet__sheet"
				role="dialog"
				aria-modal="true"
				aria-labelledby="k7-meet-title">
				<button
					type="button"
					class="k7-meet__x"
					:aria-label="t('spreed', 'Close')"
					@click="closeMeeting">
					<IconClose :size="22" />
				</button>
				<template v-if="!meetingToken">
					<h2 id="k7-meet-title" class="k7-meet__title">
						{{ t('spreed', 'New meeting') }}
					</h2>
					<label class="k7-meet__label" for="k7-meet-name">{{ t('spreed', 'Meeting name') }}</label>
					<input
						id="k7-meet-name"
						ref="meetingInput"
						v-model="conversationName"
						class="k7-meet__input"
						type="text"
						maxlength="255"
						:placeholder="t('spreed', 'Meeting')"
						@keydown.enter.prevent="startMeeting">
					<button
						type="button"
						class="k7-meet__btn k7-meet__btn--primary"
						:disabled="meetingBusy"
						@click="startMeeting">
						{{ t('spreed', 'Create') }}
					</button>
				</template>
				<template v-else>
					<div class="k7-meet__done">
						<span class="k7-meet__check"><IconCheck :size="30" /></span>
						<h2 id="k7-meet-title" class="k7-meet__title">
							{{ meetingCopyState === 'copied' ? t('spreed', 'Link copied') : t('spreed', 'Link is ready') }}
						</h2>
					</div>
					<div class="k7-meet__link" :title="meetingLink">
						{{ meetingLink }}
					</div>
					<div v-if="meetingPassword" class="k7-meet__password">
						{{ t('spreed', 'Password: {password}', { password: meetingPassword }, { escape: false, sanitize: false }) }}
					</div>
					<button
						type="button"
						class="k7-meet__btn k7-meet__btn--soft"
						@click="copyMeetingAgain">
						{{ meetingCopyState === 'copied' ? t('spreed', 'Copy again') : t('spreed', 'Copy') }}
					</button>
					<button
						type="button"
						class="k7-meet__btn k7-meet__btn--primary"
						@click="joinMeeting">
						{{ t('spreed', 'Enter') }}
					</button>
					<button
						type="button"
						class="k7-meet__btn k7-meet__btn--soft"
						@click="closeMeeting">
						{{ t('spreed', 'Close') }}
					</button>
				</template>
			</div>
		</div>
	</Teleport>
</template>

<style lang="scss">
// ket4tec (NAS_CLOUD#332): кнопки главной — 4 в ряд на широком экране, 2x2 на ~1000 px и на телефоне, одной высоты
.k7-welcome .talk-dashboard__actions {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px;
	width: min(100%, 880px);
	margin-block-start: 16px;

	@media (max-width: 1200px) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.talk-dashboard__action { width: 100%; min-width: 0; }
	.button-vue {
		box-sizing: border-box;
		width: 100%;
		height: 52px;
		min-height: 52px;
		border-radius: 999px;
		font-weight: 600;
	}
	.button-vue__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.button-vue--primary {
		background: var(--k7u-acc) !important;
		color: #fff !important;
	}

	// ket4tec (NAS_CLOUD#502): телефон (360-402 px) — зазор 8, поля 8, шрифт 14, значок 20: самая длинная подпись (~110 px) влезает в кнопку 160 px
	@media (max-width: 1023px) {
		gap: 8px;
		.button-vue {
			--button-padding: 0 8px;
			font-size: 14px;
		}
		.button-vue__icon { width: 20px; min-width: 20px; height: 20px; min-height: 20px; }
		.button-vue__text { padding-inline-start: 4px; }
	}
}
// ket4tec: «Стол» v7 — окно новой встречи. Токены темы облака (--tk-*), запасные — цвета Стола (тёмная).
.k7-meet {
	--m-bg: var(--k7-bg2, var(--tk-bg2, #242021));
	--m-bg3: var(--k7-bg3, var(--tk-bg3, #2c2627));
	--m-fg: var(--k7-fg, var(--tk-fg, #f3eee9));
	--m-fg2: var(--k7-fg2, var(--tk-fg2, #bdb3ad));
	--m-line: var(--k7-line2, var(--tk-line2, #ffffff1f));
	--m-pill: var(--k7-pill, var(--tk-pill, #ffffff1f));
	--m-acc: var(--k7-acc, var(--tk-acc, #a86bff));
	--m-grad: linear-gradient(135deg, #5B2A86, #A86BFF);
	position: fixed;
	inset: 0;
	z-index: 100000;
	display: flex;
	align-items: flex-end;
	padding-bottom: var(--k7-sheet-bottom, 0px);
	justify-content: center;
	color: var(--m-fg);

	&__scrim {
		position: absolute;
		inset: 0;
		background: #0008;
		backdrop-filter: blur(6px);
	}

	&__sheet {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 28px 20px calc(20px + env(safe-area-inset-bottom));
		background: var(--m-bg);
		border-radius: 28px 28px var(--k7-sheet-radius-b, 0) var(--k7-sheet-radius-b, 0);
		box-shadow: 0 -12px 60px #0006, inset 0 0 0 1px var(--m-line);
	}

	&__x {
		position: absolute;
		top: 12px !important;
		inset-inline-end: 12px;
		width: 40px !important;
		height: 40px !important;
		display: grid;
		place-items: center;
		border: 0 !important;
		border-radius: 999px !important;
		background: var(--m-pill) !important;
		color: var(--m-fg) !important;
		cursor: pointer;
	}

	&__title {
		margin: 0;
		padding-inline-end: 44px;
		font-size: 22px;
		font-weight: 700;
		color: var(--m-fg);
	}

	&__label {
		color: var(--m-fg2);
		font-size: 14px;
	}

	&__input {
		box-sizing: border-box;
		width: 100% !important;
		height: 52px !important;
		margin: 0 !important;
		padding: 0 20px !important;
		border: 0 !important;
		border-radius: 999px !important;
		background: var(--m-bg3) !important;
		color: var(--m-fg) !important;
		font-size: 16px !important; // 16px: iOS does not zoom the page on focus
		box-shadow: inset 0 0 0 1px var(--m-line) !important;

		&:focus {
			outline: none;
			box-shadow: inset 0 0 0 2px var(--m-acc);
		}
	}

	&__btn {
		height: 52px !important;
		min-height: 52px !important;
		margin: 0 !important;
		border: 0 !important;
		border-radius: 999px !important;
		font-size: 16px !important;
		font-weight: 700 !important;
		cursor: pointer;

		&--primary {
			background: var(--m-grad) !important;
			color: #fff !important;
			box-shadow: 0 8px 22px #5b2a8666;
		}

		&--soft {
			background: var(--m-pill) !important;
			color: var(--m-fg) !important;
		}

		&:disabled {
			opacity: .6;
			cursor: default;
		}

		&:focus-visible {
			outline: 2px solid var(--m-acc);
			outline-offset: 2px;
		}
	}

	&__done {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-inline-end: 44px;

		.k7-meet__title { padding-inline-end: 0; white-space: nowrap; }
	}

	&__check {
		flex: none;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: #2fb36a;
		color: #fff;
	}

	&__link {
		padding: 14px 20px;
		border-radius: 999px;
		background: var(--m-bg3);
		color: var(--m-fg2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: all;
	}

	&__password {
		text-align: center;
		color: var(--m-fg);
		font-weight: 600;
		user-select: all;
	}
}

@media (min-width: 700px) {
	.k7-meet {
		align-items: center;

		&__sheet {
			width: 420px;
			border-radius: 28px;
			padding-bottom: 24px;
			box-shadow: 0 24px 80px #0007, inset 0 0 0 1px var(--m-line);
		}
	}
}
</style>
