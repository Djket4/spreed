<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcAppSidebar
		v-if="isSidebarAvailable"
		ref="sidebar"
		v-model:active="activeTab"
		:open="opened"
		:name="conversation.displayName"
		:title="conversation.displayName"
		:class="'active-tab-' + activeTab"
		:toggleClasses="{ 'chat-button-sidebar-toggle': isInCall, 'k7-guest-nochat': isInCall && isChatHidden }"
		:toggleAttrs="isInCall ? inCallToggleAttrs : undefined"
		@update:open="handleUpdateOpen"
		@update:active="handleUpdateActive"
		@closed="handleClosed">
		<!-- ket4tec v7 (решение владельца 10.11): в звонке чата в панели нет — «Участники» и «Файлы» -->
		<template v-if="isInCall" #toggle-icon>
			<IconAccountMultipleOutline :size="20" />
		</template>
		<template #info>
			<RightSidebarContent
				ref="sidebarContent"
				:isUser="!!getUserId"
				:mode="CONTENT_MODES[contentModeIndex]"
				:state="contentState"
				@update:mode="handleUpdateMode"
				@update:state="handleUpdateState" />
		</template>
		<template #description>
			<InternalSignalingHint />
			<LobbyStatus v-if="canFullModerate && hasLobbyEnabled" :token="token" />
		</template>
		<NcAppSidebarTab
			v-if="contentState === 'search'"
			id="search-messages"
			key="search-messages"
			:order="0"
			:name="t('spreed', 'Search messages')">
			<SearchMessagesTab
				:isActive="activeTab === 'search-messages'"
				@close="handleUpdateState('default')" />
		</NcAppSidebarTab>
		<NcAppSidebarTab
			v-else-if="contentState === 'threads'"
			id="threads"
			key="threads"
			:order="0"
			:name="t('spreed', 'Threads')">
			<ThreadsTab @close="handleUpdateState('default')" />
		</NcAppSidebarTab>
		<template v-else>
			<NcAppSidebarTab
				v-if="showParticipantsTab"
				id="participants"
				key="participants"
				ref="participantsTab"
				:order="2"
				:name="participantsText">
				<template #icon>
					<IconAccountMultipleOutline :size="20" />
				</template>
				<ParticipantsTab
					:canSearch="canSearchParticipants"
					:canAdd="canAddParticipants" />
			</NcAppSidebarTab>
			<!-- ket4tec (владелец 11.11): гифки и стикеры — вкладкой рядом с участниками, камеры не перекрывает -->
			<NcAppSidebarTab
				v-if="isInCall && k4stkCan()"
				id="k4-stickers"
				key="k4-stickers"
				:order="3"
				name="Гифки">
				<template #icon>
					<IconStickerEmoji :size="20" />
				</template>
				<StickerSheet />
			</NcAppSidebarTab>
			<!-- ket4tec: журнал звонка, только тест-режим владельца (NAS_CLOUD#189) -->
			<NcAppSidebarTab
				v-if="isInCall && k4stats.testmode"
				id="k4-calllog"
				key="k4-calllog"
				:order="4"
				name="Журнал">
				<template #icon>
					<IconTextBoxOutline :size="20" />
				</template>
				<K4CallLogTab />
			</NcAppSidebarTab>
			<NcAppSidebarTab
				v-if="showBreakoutRoomsTab && !isInCall"
				id="breakout-rooms"
				key="breakout-rooms"
				ref="breakout-rooms"
				:order="3"
				:name="breakoutRoomsText">
				<template #icon>
					<IconDotsCircle :size="20" />
				</template>
				<BreakoutRoomsTab
					:mainToken="mainConversationToken"
					:mainConversation="mainConversation"
					:isActive="activeTab === 'breakout-rooms'" />
			</NcAppSidebarTab>
			<NcAppSidebarTab
				v-if="showDetailsTab && !isInCall"
				id="details-tab"
				key="details-tab"
				:order="4"
				:name="t('spreed', 'Details')">
				<template #icon>
					<IconInformationOutline :size="20" />
				</template>
				<SetGuestUsername v-if="!getUserId" />
				<SipSettings v-if="showSIPSettings" :conversation="conversation" />
				<div v-if="!getUserId" id="app-settings">
					<div id="app-settings-header">
						<NcButton variant="tertiary" @click="showSettings">
							<template #icon>
								<IconCogOutline :size="20" />
							</template>
							{{ t('spreed', 'Settings') }}
						</NcButton>
					</div>
				</div>
			</NcAppSidebarTab>
			<NcAppSidebarTab
				v-if="showSharedItemsTab"
				id="shared-items"
				key="shared-items"
				ref="sharedItemsTab"
				:order="5"
				:name="isInCall ? 'Файлы' : t('spreed', 'Shared items')">
				<template #icon>
					<NcIconSvgWrapper :svg="IconPermMediaOutline" :size="20" inline />
				</template>
				<K4Snaps v-if="isInCall" :active="opened && activeTab === 'shared-items'" />
				<SharedItemsTab
					:active="activeTab === 'shared-items'"
					@showThreadsTab="handleUpdateState('threads')" />
			</NcAppSidebarTab>
		</template>
	</NcAppSidebar>
</template>

<script>
import { showMessage } from '@nextcloud/dialogs'
import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { useEventListener } from '@vueuse/core'
import { ref } from 'vue'
import NcAppSidebar from '@nextcloud/vue/components/NcAppSidebar'
import NcAppSidebarTab from '@nextcloud/vue/components/NcAppSidebarTab'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import IconAccountMultipleOutline from 'vue-material-design-icons/AccountMultipleOutline.vue'
import IconCogOutline from 'vue-material-design-icons/CogOutline.vue'
import IconDotsCircle from 'vue-material-design-icons/DotsCircle.vue'
import IconInformationOutline from 'vue-material-design-icons/InformationOutline.vue'
import IconTextBoxOutline from 'vue-material-design-icons/TextBoxOutline.vue' // ket4tec
import IconStickerEmoji from 'vue-material-design-icons/StickerEmoji.vue' // ket4tec: k4stk
import K4CallLogTab from '../CallView/k4log/K4CallLogTab.vue' // ket4tec
import K4Snaps from '../CallView/k4draw/K4Snaps.vue'
import StickerSheet from '../CallView/k4stk/StickerSheet.vue' // ket4tec: k4stk
import SetGuestUsername from '../SetGuestUsername.vue'
import BreakoutRoomsTab from './BreakoutRooms/BreakoutRoomsTab.vue'
import InternalSignalingHint from './InternalSignalingHint.vue'
import LobbyStatus from './LobbyStatus.vue'
import ParticipantsTab from './Participants/ParticipantsTab.vue'
import RightSidebarContent from './RightSidebarContent.vue'
import SearchMessagesTab from './SearchMessages/SearchMessagesTab.vue'
import SharedItemsTab from './SharedItems/SharedItemsTab.vue'
import SipSettings from './SipSettings.vue'
import ThreadsTab from './Threads/ThreadsTab.vue'
import IconPermMediaOutline from '../../../img/material-icons/perm-media-outline.svg?raw'
import { useGetParticipants } from '../../composables/useGetParticipants.ts'
import { useGetToken } from '../../composables/useGetToken.ts'
import { ATTENDEE, CONVERSATION, PARTICIPANT, WEBINAR } from '../../constants.ts'
import { getTalkConfig, hasTalkFeature } from '../../services/CapabilitiesManager.ts'
import { useActorStore } from '../../stores/actor.ts'
import { useSidebarStore } from '../../stores/sidebar.ts'
import { isChatHiddenForActor } from '../../utils/chatHidden.ts'
import { isChannelConversation } from '../../utils/conversation.ts'
import { k4stats } from '../../utils/k4stats.js' // ket4tec
import { state as k4stk, canUse as k4stkCan } from '../CallView/k4stk/useStickers.js' // ket4tec: k4stk

const canStartConversations = getTalkConfig('local', 'conversations', 'can-create')
const supportConversationCreationAll = hasTalkFeature('local', 'conversation-creation-all')

const CONTENT_MODES = ['compact', 'preview', 'full']

export default {
	name: 'RightSidebar',
	components: {
		BreakoutRoomsTab,
		K4CallLogTab,
		K4Snaps,
		InternalSignalingHint,
		LobbyStatus,
		NcAppSidebar,
		NcAppSidebarTab,
		IconStickerEmoji,
		IconTextBoxOutline,
		StickerSheet,
		NcButton,
		NcIconSvgWrapper,
		ParticipantsTab,
		RightSidebarContent,
		SearchMessagesTab,
		SetGuestUsername,
		SharedItemsTab,
		ThreadsTab,
		SipSettings,
		// Icons
		IconAccountMultipleOutline,
		IconCogOutline,
		IconDotsCircle,
		IconInformationOutline,
	},

	props: {
		isInCall: {
			type: Boolean,
			required: true,
		},
	},

	setup() {
		const activeTab = ref('participants')
		useGetParticipants(activeTab)

		const sidebar = ref(null)
		const sidebarContent = ref(null)
		const contentModeIndex = ref(0)

		let throttleTimeout = null
		const throttleHandleWheelEvent = (event) => {
			if (!throttleTimeout) {
				handleWheelEvent(event)
			}
			clearTimeout(throttleTimeout)
			throttleTimeout = null
			throttleTimeout = setTimeout(() => {
				clearTimeout(throttleTimeout)
				throttleTimeout = null
			}, 100 /* delay after last fired event */)
		}

		useEventListener(sidebar, 'wheel', throttleHandleWheelEvent, { capture: true })

		/**
		 * Listen to wheel event on sidebar to switch between header info appearances
		 *
		 * @param {Event} event Wheel event
		 */
		function handleWheelEvent(event) {
			// [1]: scrolling up; [-1]: scrolling down
			const direction = event.deltaY < 0 ? 1 : -1

			if (!CONTENT_MODES[contentModeIndex.value + direction]) {
				// Already at the edge state
				return
			}

			if (direction === -1) {
				// Shrink before scrolling other content (block following scroll events)
				event.preventDefault()
			} else {
				if (!sidebarContent.value?.$el?.contains(event.target)) {
					// Expand only if event happens within the RightSidebarContent component
					return
				}
			}

			contentModeIndex.value += direction
		}

		return {
			k4stats, // ket4tec
			IconPermMediaOutline,
			activeTab,
			CONTENT_MODES,
			contentModeIndex,
			sidebar,
			sidebarContent,
			sidebarStore: useSidebarStore(),
			actorStore: useActorStore(),
			token: useGetToken(),
		}
	},

	data() {
		return {
			contactsLoading: false,
			unreadNotificationHandle: null,
			contentState: 'default',
			previousActiveTab: 'participants',
		}
	},

	computed: {
		isSidebarAvailable() {
			return this.token && !this.isInLobby
		},

		show() {
			return this.sidebarStore.show
		},

		opened() {
			return this.isSidebarAvailable && this.show
		},

		conversation() {
			return this.$store.getters.conversation(this.token) || this.$store.getters.dummyConversation
		},

		mainConversationToken() {
			if (this.conversation.objectType === CONVERSATION.OBJECT_TYPE.BREAKOUT_ROOM) {
				return this.conversation.objectId
			}
			return this.token
		},

		mainConversation() {
			return this.$store.getters.conversation(this.mainConversationToken) || this.$store.getters.dummyConversation
		},

		getUserId() {
			return this.actorStore.userId
		},

		canAddParticipants() {
			return this.canFullModerate && this.canSearchParticipants
		},

		canSearchParticipants() {
			return this.conversation.type === CONVERSATION.TYPE.GROUP
				|| (this.conversation.type === CONVERSATION.TYPE.PUBLIC && this.conversation.objectType !== CONVERSATION.OBJECT_TYPE.VIDEO_VERIFICATION)
				|| (this.conversation.type === CONVERSATION.TYPE.ONE_TO_ONE && canStartConversations && supportConversationCreationAll)
		},

		canFullModerate() {
			return this.conversation.participantType === PARTICIPANT.TYPE.OWNER
				|| this.conversation.participantType === PARTICIPANT.TYPE.MODERATOR
		},

		isGuestModerator() {
			return this.conversation?.participantType === PARTICIPANT.TYPE.GUEST_MODERATOR
		},

		isInLobby() {
			return this.$store.getters.isInLobby
		},

		showSIPSettings() {
			return this.conversation.sipEnabled !== WEBINAR.SIP.DISABLED
				&& this.conversation.attendeePin
		},

		hasLobbyEnabled() {
			return this.conversation.lobbyState === WEBINAR.LOBBY.NON_MODERATORS
		},

		isOneToOne() {
			return this.conversation.type === CONVERSATION.TYPE.ONE_TO_ONE
				|| this.conversation.type === CONVERSATION.TYPE.ONE_TO_ONE_FORMER
		},

		participantsText() {
			const participants = this.$store.getters.participantsList(this.token).filter((participant) => {
				return participant.actorType !== ATTENDEE.ACTOR_TYPE.GROUPS
					&& participant.actorType !== ATTENDEE.ACTOR_TYPE.CIRCLES
					&& participant.actorType !== ATTENDEE.ACTOR_TYPE.TEAMS
					&& participant.actorType !== ATTENDEE.ACTOR_TYPE.BOTS
					&& participant.actorType !== ATTENDEE.ACTOR_TYPE.BRIDGED
			})
			return t('spreed', 'Participants ({count})', { count: participants.length })
		},

		breakoutRoomsConfigured() {
			return this.conversation.breakoutRoomMode !== CONVERSATION.BREAKOUT_ROOM_MODE.NOT_CONFIGURED
		},

		showBreakoutRoomsTab() {
			return this.getUserId && !this.isOneToOne
				&& !this.conversation.remoteServer // no breakout rooms support in federated conversations
				&& !isChannelConversation(this.conversation)
				&& (this.breakoutRoomsConfigured || this.conversation.breakoutRoomMode === CONVERSATION.BREAKOUT_ROOM_MODE.FREE || this.conversation.objectType === CONVERSATION.OBJECT_TYPE.BREAKOUT_ROOM)
		},

		showParticipantsTab() {
			return (this.getUserId || this.isGuestModerator)
				&& (!this.isOneToOne || this.isInCall)
				&& !this.isNoteToSelf
				&& !this.isChangelog
				&& (!isChannelConversation(this.conversation) || this.$store.getters.isModerator)
		},

		isChatHidden() {
			return isChatHiddenForActor(this.actorStore.actorType)
		},

		showSharedItemsTab() {
			return !this.isChatHidden && (!this.conversation.remoteServer || hasTalkFeature(this.token, 'federated-shared-items'))
		},

		showDetailsTab() {
			return !this.getUserId || this.showSIPSettings
		},

		isNoteToSelf() {
			return this.conversation.type === CONVERSATION.TYPE.NOTE_TO_SELF
		},

		isChangelog() {
			return this.conversation.type === CONVERSATION.TYPE.CHANGELOG
		},

		breakoutRoomsText() {
			return t('spreed', 'Breakout rooms')
		},

		unreadMessagesCounter() {
			return this.conversation.unreadMessages
		},

		hasUnreadMentions() {
			return this.conversation.unreadMention
		},

		k4stkOpen() {
			return this.opened && this.activeTab === 'k4-stickers'
		},

		inCallToggleAttrs() {
			return {
				'data-theme-dark': true,
				'aria-label': 'Участники и файлы',
				title: 'Участники и файлы',
			}
		},
	},

	watch: {
		// ket4tec: k4stk — кнопка «Гифки» в панели звонка подсвечена, пока открыта вкладка
		k4stkOpen: {
			immediate: true,
			handler(v) { k4stk.open = v },
		},

		conversation(newConversation, oldConversation) {
			if (newConversation.token === oldConversation.token || !this.showParticipantsTab) {
				return
			}

			// Remain on "breakout-rooms" tab, when switching back to main room
			if (this.breakoutRoomsConfigured && this.activeTab === 'breakout-rooms') {
				return
			}

			// In other case switch to other tabs
			this.activeTab = this.isInCall ? this.inCallTab() : 'participants'
		},

		showParticipantsTab: {
			immediate: true,
			handler(value) {
				if (!value) {
					if (!this.getUserId) {
						// Guests
						this.activeTab = 'details'
					} else {
						// Users in one-to-one
						this.activeTab = 'shared-items'
					}
				}
			},
		},

		unreadMessagesCounter(newValue, oldValue) {
			if (!this.isInCall || this.opened) {
				return
			}

			// new messages arrived
			if (newValue > 0 && oldValue === 0 && !this.hasUnreadMentions) {
				this.notifyUnreadMessages(t('spreed', 'You have new unread messages in the chat.'))
			}
		},

		hasUnreadMentions(newValue) {
			if (!this.isInCall || this.opened) {
				return
			}

			if (newValue) {
				this.notifyUnreadMessages(t('spreed', 'You have been mentioned in the chat.'))
			}
		},

		isInCall(newValue) {
			if (newValue) {
				// ket4tec v7: в звонке вкладки «Участники» и «Файлы», чата нет
				this.contentState = 'default'
				this.activeTab = this.inCallTab()
				// ket4tec v7: в звонке список участников открыт (владелец 11.11, NAS_CLOUD#109 п.30); на телефоне панель во весь экран — закрыта. После звонка — как была
				this.k7reopen = this.sidebarStore.show
				// гостю (нет ни «Участников», ни «Файлов») панель сама не открывается — в ней только «Гифки», по кнопке (владелец 12.11, NAS_CLOUD#149)
				if (window.innerWidth < 512 || !(this.showParticipantsTab || this.showSharedItemsTab)) {
					this.sidebarStore.hideSidebar({ cache: false })
				} else {
					this.sidebarStore.showSidebar({ cache: false })
				}
				return
			}

			// discard notification if the call ends
			this.notifyUnreadMessages(null)
			if (this.k7reopen) {
				this.k7reopen = false
				this.sidebarStore.showSidebar({ cache: false })
			} else {
				this.sidebarStore.hideSidebar({ cache: false })
			}

			// после звонка — участники (в один-на-один их нет, остаются «Общие файлы»)
			if (!this.isOneToOne && this.showParticipantsTab) {
				this.activeTab = 'participants'
			}
		},

		token: {
			handler() {
				if (this.$refs.participantsTab) {
					this.$refs.participantsTab.$el.scrollTop = 0
				}

				// Discard notification if the conversation changes or closed
				this.notifyUnreadMessages(null)

				if (this.isOneToOne || this.conversation.messageExpiration) {
					this.contentModeIndex = 1
				} else {
					this.contentModeIndex = 0
				}
			},

			immediate: true,
		},

		'conversation.messageExpiration': function(value) {
			if (value) {
				this.contentModeIndex = 1
			}
		},

		isGuestModerator(newValue) {
			if (newValue && !this.isInCall) {
				// Switch active tab to participants list if guest was promoted to moderators
				this.activeTab = 'participants'
			} else if (this.isInCall) {
				this.activeTab = this.inCallTab()
			}
		},
	},

	mounted() {
		subscribe('spreed:select-active-sidebar-tab', this.handleUpdateActive)
	},

	beforeUnmount() {
		unsubscribe('spreed:select-active-sidebar-tab', this.handleUpdateActive)
	},

	methods: {
		t,
		k4stkCan,

		handleUpdateOpen(open) {
			if (open) {
				// в звонке по умолчанию «Участники»
				if (this.isInCall && !['participants', 'shared-items', 'k4-stickers'].includes(this.activeTab)) {
					this.activeTab = this.inCallTab()
				}
				this.sidebarStore.showSidebar()
			} else {
				this.sidebarStore.hideSidebar()
			}
		},

		handleUpdateActive(active) {
			switch (active) {
				case 'search-messages':
					this.handleUpdateState('search')
					break
				case 'threads':
					this.handleUpdateState('threads')
					break
				default:
					this.contentState = 'default'
					this.activeTab = active
			}
		},

		handleUpdateMode(mode) {
			const newModeIndex = CONTENT_MODES.findIndex((m) => m === mode)
			if (newModeIndex !== -1) {
				this.contentModeIndex = newModeIndex
			}
		},

		handleUpdateState(value) {
			if (value === this.contentState) {
				return
			}
			// Remember the tab to return to, but only when leaving the default state,
			// so re-entering search / threads does not make them their own previous tab
			if (this.contentState === 'default') {
				this.previousActiveTab = this.activeTab
			}
			this.contentState = value
			// FIXME upstream: NcAppSidebar should emit update:active
			if (value === 'search') {
				this.activeTab = 'search-messages'
			} else if (value === 'threads') {
				this.activeTab = 'threads'
			} else {
				this.activeTab = this.previousActiveTab
			}
		},

		/** Вкладка звонка по умолчанию: «Участники», если их нет — «Файлы». */
		inCallTab() {
			return this.showParticipantsTab ? 'participants' : 'shared-items'
		},

		showSettings() {
			emit('show-settings', {})
		},

		handleClosed() {
			emit('files:sidebar:closed', {})
		},

		notifyUnreadMessages(message) {
			if (this.unreadNotificationHandle) {
				this.unreadNotificationHandle.hideToast()
				this.unreadNotificationHandle = null
			}
			if (message) {
				this.unreadNotificationHandle = showMessage(message, {
					// в звонке чата в панели нет: тост только сообщает
					onClick: () => this.isInCall || this.sidebarStore.showSidebar(),
				})
			}
		},
	},
}
</script>

<style lang="scss" scoped>
// Override NcAppSidebar styles
:deep(.app-sidebar-header__description) {
	flex-direction: column;
}

// FIXME upstream: move styles to nextcloud-vue library
:deep(.app-sidebar-tabs__nav) {
	padding: 0 10px;

	.checkbox-radio-switch__label {
		text-align: center;
		justify-content: flex-start;
	}

	.checkbox-radio-switch__icon {
		flex-basis: auto;

		span {
			margin: 0;
		}
	}
}

:deep(.app-sidebar-tabs__content) {
	/* Allow to shrink tabs content in favor of header information */
	min-height: inherit !important;
}

.app-sidebar-tabs__content #tab-participants {
	/* Remove padding to maximize the space for the participants list. */
	padding: var(--default-grid-baseline) 0;
	height: 100%;
}

</style>

<style lang="scss">
/*
 * NcAppSidebar toggle it rendered on the page outside the sidebar element, so we need global styles here.
 * It is _quite_ safe, as chat-button-sidebar-toggle class is defined here manually, not an internal class.
 */
/* ket4tec #55: у гостя в звонке кнопки чата нет */
.chat-button-sidebar-toggle.k7-guest-nochat {
	display: none !important;
}

.chat-button-sidebar-toggle {
	position: relative;
	// Allow unread counter to overflow rounded button
	overflow: visible !important;
}
</style>
