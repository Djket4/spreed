<!--
  - SPDX-FileCopyrightText: 2025 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script lang="ts" setup>
import type { Conversation } from '../../types/index.ts'

import { getRequestToken } from '@nextcloud/auth'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { emit } from '@nextcloud/event-bus'
import { isRTL, t } from '@nextcloud/l10n'
import { generateUrl, imagePath } from '@nextcloud/router'
import { useIsDarkTheme } from '@nextcloud/vue/composables/useIsDarkTheme'
import { useIsMobile, useIsSmallMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconArrowLeft from 'vue-material-design-icons/ArrowLeft.vue'
import IconArrowRight from 'vue-material-design-icons/ArrowRight.vue'
import IconCalendarBlankOutline from 'vue-material-design-icons/CalendarBlankOutline.vue'
import IconCheck from 'vue-material-design-icons/Check.vue'
import IconClose from 'vue-material-design-icons/Close.vue'
import IconMicrophoneOutline from 'vue-material-design-icons/MicrophoneOutline.vue'
import IconPhoneOutline from 'vue-material-design-icons/PhoneOutline.vue'
import IconPlus from 'vue-material-design-icons/Plus.vue'
import IconVideoOutline from 'vue-material-design-icons/VideoOutline.vue'
import ConversationsListVirtual from '../LeftSidebar/ConversationsList/ConversationsListVirtual.vue'
import SearchMessageItem from '../RightSidebar/SearchMessages/SearchMessageItem.vue'
import LoadingPlaceholder from '../UIShared/LoadingPlaceholder.vue'
import DashboardSection from './DashboardSection.vue'
import EventCard from './EventCard.vue'
import { CONVERSATION } from '../../constants.ts'
import { getTalkConfig, hasTalkFeature, localCapabilities } from '../../services/CapabilitiesManager.ts'
import { EventBus } from '../../services/EventBus.ts'
import { useActorStore } from '../../stores/actor.ts'
import { useDashboardStore } from '../../stores/dashboard.ts'
import { hasUnreadMentions } from '../../utils/conversation.ts'
import { convertToUnix } from '../../utils/formattedTime.ts'
import generatePassword from '../../utils/generatePassword.ts'
import { generateFullConversationLink } from '../../utils/handleUrl.ts'

const supportsUpcomingReminders = hasTalkFeature('local', 'upcoming-reminders')
const canModerateSipDialOut = hasTalkFeature('local', 'sip-support-dialout')
	&& getTalkConfig('local', 'call', 'sip-enabled')
	&& getTalkConfig('local', 'call', 'sip-dialout-enabled')
	&& getTalkConfig('local', 'call', 'can-enable-sip')
const isCallEnabled = getTalkConfig('local', 'call', 'enabled')
const hasMeetings = isCallEnabled || !!getTalkConfig('local', 'call', 'external-call-service')
const canStartConversations = getTalkConfig('local', 'conversations', 'can-create')
const forcePasswordProtection = getTalkConfig('local', 'conversations', 'force-passwords')
const isCalendarEnabled = localCapabilities.calendar?.webui ?? false
const isDirectionRTL = isRTL()
const isDarkTheme = useIsDarkTheme()
const isMobile = useIsMobile()
const isSmallMobile = useIsSmallMobile()

/**
 * Path of the dashboard illustration matching the current direction and theme.
 * Right-to-left locales use the mirrored variant, dark themes the dark one.
 *
 * @param name - File name in img/dashboard/, without the extension and the `-rtl` / `-dark` suffixes
 */
function illustration(name: string): string {
	const variant = name + (isDirectionRTL ? '-rtl' : '') + (isDarkTheme.value ? '-dark' : '')
	return imagePath('spreed', `dashboard/${variant}.webp`)
}

const store = useStore()
const router = useRouter()
const dashboardStore = useDashboardStore()
const actorStore = useActorStore()
const forwardScrollable = ref(false)
const backwardScrollable = ref(false)
const eventCardsWrapper = ref<HTMLDivElement | null>(null)
const eventRooms = computed(() => dashboardStore.eventRooms || [])
const upcomingReminders = computed(() => dashboardStore.upcomingReminders || [])
const eventsInitialised = computed(() => dashboardStore.eventRoomsInitialised)
const remindersInitialised = computed(() => dashboardStore.upcomingRemindersInitialised)
const conversationName = ref('')
let actualizeDataInterval: ReturnType<typeof setInterval> | null = null

// Data fetching handlers

/**
 * Fetches all necessary data for the dashboard.
 */
async function actualizeData() {
	await Promise.all([
		hasMeetings && dashboardStore.fetchDashboardEventRooms(),
		dashboardStore.fetchUpcomingReminders(),
	])
}

/**
 * Initializes the data fetching interval and fetches initial data.
 */
function initActualizeData() {
	if (actualizeDataInterval) {
		clearInterval(actualizeDataInterval)
	}
	actualizeData()
	actualizeDataInterval = setInterval(actualizeData, 300_000)
}

initActualizeData()
EventBus.on('refresh-talk-dashboard', initActualizeData)

onBeforeUnmount(() => {
	if (actualizeDataInterval) {
		clearInterval(actualizeDataInterval)
	}

	if (eventCardsWrapper?.value) {
		resizeObserver.disconnect()
	}

	EventBus.off('refresh-talk-dashboard', initActualizeData)
})

watch(eventCardsWrapper, (newValue) => {
	if (newValue) {
		resizeObserver.observe(newValue)
	}
})

/**
 * Updates the scrollable flags based on the current scroll position.
 */
async function updateScrollableFlags() {
	await nextTick()
	if (eventCardsWrapper.value) {
		const { scrollLeft, scrollWidth, clientWidth } = eventCardsWrapper.value
		backwardScrollable.value = isDirectionRTL ? scrollLeft < 0 : scrollLeft > 0
		forwardScrollable.value = (isDirectionRTL ? -1 : 1) * scrollLeft + clientWidth < scrollWidth - 10 // 10px tolerance
	}
}

// Use ResizeObserver to detect size changes
const resizeObserver = new ResizeObserver(() => {
	updateScrollableFlags()
})

const conversationsInitialised = computed(() => store.getters.conversationsInitialised)
const filteredConversations = computed(() => {
	return (store.getters.conversationsList as Conversation[])
		.filter(hasUnreadMentions)
		.sort((conversation1, conversation2) => conversation2.lastActivity - conversation1.lastActivity)
})

const meetingOpen = ref(false)
const meetingBusy = ref(false)
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
	let resolveText!: (text: string) => void
	let rejectText!: (error: unknown) => void
	const textPromise = new Promise<string>((resolve, reject) => {
		resolveText = resolve
		rejectText = reject
	})
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

/**
 * Scrolls the event cards wrapper in the specified direction.
 *
 * @param payload
 * @param payload.direction - The direction to scroll ('backward' or 'forward').
 */
function scrollEventCards({ direction }: { direction: 'backward' | 'forward' }) {
	const scrollDirection = (direction === 'backward' ? -1 : 1) * (isDirectionRTL ? -1 : 1)
	if (eventCardsWrapper.value) {
		const ITEM_WIDTH = 300 + 8 // 300px width + 8px gap
		let scrollAmount = 0
		const visibleItems = Math.floor(eventCardsWrapper.value.clientWidth / ITEM_WIDTH)
		if (visibleItems === 0) {
			scrollAmount = eventCardsWrapper.value.clientWidth * scrollDirection
		} else {
			scrollAmount = visibleItems * ITEM_WIDTH * scrollDirection
			// Arrow buttons are 34px wide
			if (!backwardScrollable.value && scrollDirection === 1) {
				scrollAmount -= 34
			} else if (!forwardScrollable.value && scrollDirection === -1) {
				scrollAmount += 34
			}
		}

		eventCardsWrapper.value.scrollBy({
			left: scrollAmount,
			behavior: 'smooth',
		})
	}
}
</script>

<template>
	<div
		class="talk-dashboard-wrapper"
		:class="{
			'talk-dashboard-wrapper--mobile': isMobile,
			'talk-dashboard-wrapper--small-mobile': isSmallMobile,
		}">
		<div class="talk-dashboard__menu">
			<h2 class="talk-dashboard__header">
				{{ t('spreed', 'Hello, {displayName}', { displayName: actorStore.displayName }, { escape: false }) }}
			</h2>
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
					@click="EventBus.emit('new-conversation-dialog:show')">
					<template #icon>
						<IconPlus :size="20" />
					</template>
					{{ t('spreed', 'New conversation') }}
				</NcButton>

				<NcButton
					v-if="isCallEnabled && canModerateSipDialOut"
					class="talk-dashboard__action"
					@click="EventBus.emit('call-phone-dialog:show')">
					<template #icon>
						<IconPhoneOutline :size="20" />
					</template>
					{{ t('spreed', 'Call a phone number') }}
				</NcButton>
				<NcButton
					v-if="isCallEnabled"
					class="talk-dashboard__action"
					variant="secondary"
					@click="emit('talk:media-settings:show', 'device-check')">
					<template #icon>
						<IconMicrophoneOutline :size="20" />
					</template>
					{{ t('spreed', 'Check devices') }}
				</NcButton>
			</div>
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
		<div class="talk-dashboard__items">
			<div v-if="hasMeetings" class="event-section">
				<DashboardSection
					v-if="!eventsInitialised || eventRooms.length > 0"
					:title="t('spreed', 'Upcoming meetings')"
					:backgroundImage="illustration('meetings')">
					<template #list>
						<LoadingPlaceholder
							v-if="!eventsInitialised"
							type="event-cards" />
						<div
							v-else
							class="talk-dashboard__event-cards-wrapper"
							:class="{ 'forward-scrollable': forwardScrollable, 'backward-scrollable': backwardScrollable }">
							<div
								ref="eventCardsWrapper"
								class="talk-dashboard__event-cards"
								@scroll.passive="updateScrollableFlags">
								<EventCard
									v-for="eventRoom in eventRooms"
									:key="`${eventRoom.eventLink}-${eventRoom.start}`"
									:eventRoom="eventRoom"
									class="talk-dashboard__event-card" />
							</div>
							<div class="talk-dashboard__event-cards__scroll-indicator">
								<NcButton
									v-show="backwardScrollable"
									class="button-slide backward"
									variant="tertiary"
									:title="t('spreed', 'Scroll backward')"
									:aria-label="t('spreed', 'Scroll backward')"
									@click="scrollEventCards({ direction: 'backward' })">
									<template #icon>
										<IconArrowLeft class="bidirectional-icon" />
									</template>
								</NcButton>
								<NcButton
									v-show="forwardScrollable"
									class="button-slide forward"
									variant="tertiary"
									:title="t('spreed', 'Scroll forward')"
									:aria-label="t('spreed', 'Scroll forward')"
									@click="scrollEventCards({ direction: 'forward' })">
									<template #icon>
										<IconArrowRight class="bidirectional-icon" />
									</template>
								</NcButton>
							</div>
						</div>
					</template>
				</DashboardSection>
				<DashboardSection
					v-else
					class="event-section--empty"
					wide
					:title="t('spreed', 'Schedule meetings')"
					:subtitle="t('spreed', 'You don\'t have any upcoming meetings')"
					:description="t('spreed', 'Calendar events with a conversation link as the location are shown here')"
					:backgroundImage="illustration('meetings')">
					<template #action>
						<NcButton
							v-if="isCalendarEnabled"
							variant="secondary"
							:href="generateUrl('apps/calendar')"
							target="_blank">
							<template #icon>
								<IconCalendarBlankOutline :size="20" />
							</template>
							{{ t('spreed', 'Open calendar') }}
						</NcButton>
					</template>
				</DashboardSection>
			</div>
			<div class="talk-dashboard__chats">
				<div class="talk-dashboard__unread-mentions">
					<DashboardSection
						v-if="filteredConversations.length > 0 || !conversationsInitialised"
						:title="t('spreed', 'Unread mentions')"
						:backgroundImage="illustration('mentions')">
						<template #list>
							<ConversationsListVirtual
								class="talk-dashboard__conversations-list"
								:conversations="filteredConversations"
								:loading="!conversationsInitialised" />
						</template>
					</DashboardSection>
					<DashboardSection
						v-else
						:title="t('spreed', 'Unread mentions')"
						:description="t('spreed', 'Messages where you were mentioned will show up here. You can mention people by typing @ followed by their name')"
						:backgroundImage="illustration('mentions')" />
				</div>
				<div
					v-if="supportsUpcomingReminders"
					class="talk-dashboard__upcoming-reminders">
					<DashboardSection
						v-if="upcomingReminders.length > 0 || !remindersInitialised"
						:title="t('spreed', 'Upcoming reminders')"
						:backgroundImage="illustration('reminders')">
						<template #list>
							<ul v-if="remindersInitialised" class="upcoming-reminders-list">
								<SearchMessageItem
									v-for="reminder in upcomingReminders"
									:key="reminder.messageId"
									:messageId="reminder.messageId"
									:title="reminder.actorDisplayName"
									:subline="reminder.message"
									:messageParameters="reminder.messageParameters"
									:token="reminder.roomToken"
									:to="{
										name: 'conversation',
										params: { token: reminder.roomToken },
										hash: `#message_${reminder.messageId}`,
									}"
									:actorId="reminder.actorId"
									:actorType="reminder.actorType"
									:timestamp="reminder.reminderTimestamp"
									isReminder />
							</ul>
							<LoadingPlaceholder
								v-else
								class="upcoming-reminders__loading-placeholder"
								type="conversations" />
						</template>
					</DashboardSection>
					<DashboardSection
						v-else
						:title="t('spreed', 'Message reminders')"
						:description="t('spreed', 'Set a reminder on a message to be notified')"
						:backgroundImage="illustration('reminders')" />
				</div>
			</div>
		</div>
	</div>
</template>

<style lang="scss" scoped>
@use '../../assets/variables.scss' as *;

.talk-dashboard-wrapper {
	--dashboard-max-height: 800px;
	--dashboard-max-width: 900px;
	padding: calc(var(--default-grid-baseline) * 2);
	width: min(100%, calc(100vw - 300px - var(--body-container-margin) * 2)); // 300px for the left sidebar and body container margins
	margin: 0 auto;
	display: flex;
	flex-direction: column;
	gap: calc(var(--default-grid-baseline) * 4);
	height: 100%;
	max-height: var(--dashboard-max-height);
	max-width: var(--dashboard-max-width);

	&--mobile {
		width: 100%;

		.talk-dashboard__header {
			margin-block-start: 0;
			padding-inline-start: clamp(0px, calc(var(--dashboard-max-width) / 2 + var(--app-navigation-toggle-space) - 50vw), var(--app-navigation-toggle-space));
		}
	}

	&--small-mobile {
		width: 100%;
		height: auto;
		max-height: none;

		.talk-dashboard__chats {
			grid-template-columns: 1fr;
		}
	}
}

.talk-dashboard__header {
	--app-navigation-toggle-space: calc(var(--default-clickable-area) + var(--default-grid-baseline));
	font-size: 21px; // NcDialog header font size
	font-weight: bold;
	margin-inline: auto;
	margin-block-start: clamp(0px, calc(100vh - var(--dashboard-max-height)), var(--app-navigation-toggle-space));
	margin-block-end: calc(var(--default-grid-baseline) * 2);
}

// var(--dashboard-max-height) + var(--header-height) + var(--body-container-margin)
@media (max-height: 852px) {
	.talk-dashboard__header {
		margin-block-start: 0;
		--min-width-with-navigation: calc(var(--body-container-margin) * 2 + 300px + var(--dashboard-max-width));
		padding-inline-start: clamp(0px, calc(var(--min-width-with-navigation) / 2 + var(--app-navigation-toggle-space) - 50vw), var(--app-navigation-toggle-space));
	}
}

.talk-dashboard__actions {
	display: flex;
	gap: calc(var(--default-grid-baseline) * 2);
	flex-wrap: wrap;
	flex-direction: row;

	:deep(.button-vue),
	:deep(.v-popper--theme-dropdown) {
		height: var(--header-menu-item-height);
		border-radius: var(--border-radius-large);
	}

	:deep(.button-vue) {
		padding-inline: calc(var(--default-grid-baseline) * 2) calc(var(--default-grid-baseline) * 4);
	}
}

// Spread the actions across the full width of every row they wrap onto
.talk-dashboard__action {
	flex: 1 0 calc(50% - var(--default-grid-baseline));

	// The popover only wraps its trigger, so the button inside has to stretch as well
	:deep(.button-vue) {
		width: 100%;
	}
}

.event-section {
	:deep(.dashboard-section--list) {
		.dashboard-section__content {
			padding-inline: 0;
		}

		.dashboard-section__title {
			padding-inline: var(--dashboard-section-inline-padding);
		}
	}

	&--empty {
		height: 225px;
	}
}

.talk-dashboard__event-cards {
	display: flex;
	flex-wrap: nowrap;
	gap: calc(var(--default-grid-baseline) * 2);
	margin-block: var(--default-grid-baseline);
	overflow-x: auto;
	scrollbar-width: none;

	// Keep the outermost cards off the edges of the section, in line with the section title
	> :first-child {
		margin-inline-start: var(--dashboard-section-inline-padding);
	}

	> :last-child {
		margin-inline-end: var(--dashboard-section-inline-padding);
	}
}

.talk-dashboard__event-cards-wrapper {
	position: relative;
	margin-bottom: calc(var(--default-grid-baseline) * 2);

	&::before,
	&::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: var(--default-clickable-area);
		pointer-events: none;
		z-index: 2;
	}

	.button-slide {
		position: absolute !important;
		display: flex;
		top: calc(var(--default-grid-baseline) * 2);
		padding: 0;
		height: calc(100% - var(--default-grid-baseline) * 4);
		margin: 0 var(--default-grid-baseline) !important;
		z-index: 3;
		justify-content: left;
		background: var(--color-main-background);
		border-radius: var(--border-radius-large);
		box-shadow: 0 1px 5px rgba(var(--color-box-shadow-rgb), 0.2);

		&.backward {
			inset-inline-start: 0;
		}

		&.forward {
			inset-inline-end: 0;
		}
	}
}

.talk-dashboard__calendar-button {
	position: absolute !important;
	bottom: calc(var(--default-grid-baseline) * 2);
	inset-inline-start: calc(var(--default-grid-baseline) * 2);
}

.talk-dashboard__items {
	display: flex;
	flex-direction: column;
	gap: calc(var(--default-grid-baseline) * 4);
	justify-content: space-around;
	min-width: 0;
	flex-grow: 3;
}

.talk-dashboard__chats {
	display: grid;
	gap: calc(var(--default-grid-baseline) * 4);
	grid-template-columns: 1fr 1fr;
	flex-grow: 1;

	&> div {
		max-height: 320px;
	}
}

// In these two sections use main text color for a11y
.talk-dashboard__unread-mentions,
.talk-dashboard__upcoming-reminders {
	:deep(.list-item-content__subname) {
		color: var(--color-main-text);
	}
}

.talk-dashboard__unread-mentions {
	// Sit the text at the bottom of the card, clear of the illustration above it
	:deep(.dashboard-section__content) {
		justify-content: end;
	}
}

// Keep the text off the illustration on the trailing side of the card. Only on desktop,
// where the card is wide enough to spare the room.
.talk-dashboard-wrapper:not(.talk-dashboard-wrapper--mobile) {
	.talk-dashboard__unread-mentions,
	.talk-dashboard__upcoming-reminders {
		:deep(.dashboard-section__title),
		:deep(.dashboard-section__description) {
			max-width: 75%;
		}
	}
}

.upcoming-reminders {
	&-list {
		overflow-y: auto;
	}

	&__loading-placeholder {
		overflow: hidden;
	}
}

.talk-dashboard__conversations-list {
	flex-grow: 1;
	margin-block: var(--default-grid-baseline);
	line-height: 20px;
}

// Override NcButton styles for narrow screen size
@media screen and (max-width: $breakpoint-mobile-small) {
	.talk-dashboard__actions {
		.talk-dashboard__action {
			flex: 1 1 100%;
		}

		:deep(.button-vue),
		& > div {
			width: 100%;
		}

		:deep(.button-vue) {
			padding-inline-end: calc(var(--default-grid-baseline) * 2);
		}
	}
}
</style>

<style lang="scss">
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
// ket4tec: заглушки с картинками (встречи, упоминания, напоминания) не показываем — списки с данными остаются.
// Раньше это делала тема облака; для форка её правила главной выключены (html:not(.k7f)), поэтому здесь.
html.k7f .talk-dashboard__items:not(:has(.dashboard-section--list)),
html.k7f .talk-dashboard-wrapper :is(.event-section, .talk-dashboard__chats > div):not(:has(.dashboard-section--list)) { display: none !important; }

// ket4tec: главная Talk на телефоне — «Начать встречу» во всю ширину (Слива), под ней две капсулы в ряд
@media (max-width: 700px) {
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions {
		display: grid !important;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		width: 100%;
		margin: 0;
	}
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > * { width: auto !important; min-width: 0 !important; height: auto !important; margin: 0 !important; flex: none !important; }
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :first-child { grid-column: 1 / -1; }
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > .k7-mycall { grid-column: 1 / -1; } // «Мой звонок» во всю ширину под «Начать встречу»
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions .button-vue {
		box-sizing: border-box;
		width: 100% !important;
		height: 52px !important;
		min-height: 52px !important;
		padding: 0 10px !important;
		border: 0 !important;
		border-radius: 999px !important;
		background: var(--tk-bg2, #242021) !important;
		color: var(--tk-fg, #f3eee9) !important;
		box-shadow: inset 0 0 0 1px var(--tk-line2, #ffffff1f) !important;
	}
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :first-child.button-vue,
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :first-child .button-vue {
		background: linear-gradient(135deg, #5B2A86, #A86BFF) !important;
		color: #fff !important;
		box-shadow: 0 8px 22px #5b2a8655 !important;
	}
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions .button-vue__wrapper { justify-content: center; gap: 6px; width: 100%; }
	// две капсулы в ряд — без значков, иначе «Проверка устройств» не влезает в 402 px
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :not(:first-child) { padding-inline: 8px !important; }
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :not(:first-child) .button-vue__icon { display: none !important; }
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions > :not(:first-child) .button-vue__text { letter-spacing: -.01em; }
	html.k7f .talk-dashboard-wrapper .talk-dashboard__actions .button-vue__text { min-width: 0; margin: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px !important; font-weight: 600 !important; }
}
</style>
