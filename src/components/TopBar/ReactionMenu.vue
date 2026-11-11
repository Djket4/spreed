<!--
  - SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import type { LocalCallParticipantModel, LocalMediaModel } from '../../types/index.ts'

import { emit } from '@nextcloud/event-bus'
import { t } from '@nextcloud/l10n'
import { useHotKey } from '@nextcloud/vue/composables/useHotKey'
import { computed, watch } from 'vue'
import { useStore } from 'vuex'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionButtonGroup from '@nextcloud/vue/components/NcActionButtonGroup'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import IconEmoticonOutline from 'vue-material-design-icons/EmoticonOutline.vue'
import IconHandBackLeft from 'vue-material-design-icons/HandBackLeft.vue'
import IconHandBackLeftOutline from 'vue-material-design-icons/HandBackLeftOutline.vue'
import { CONVERSATION, PARTICIPANT } from '../../constants.ts'
import { getTalkConfig } from '../../services/CapabilitiesManager.ts'
import { useActorStore } from '../../stores/actor.ts'
import { useBreakoutRoomsStore } from '../../stores/breakoutRooms.ts'
import { useParticipantActivityStore } from '../../stores/participantActivity.ts'

const props = defineProps<{
	/* The conversation token */
	token: string
	/* Signaling participant model */
	localMediaModel: LocalMediaModel
	/* Signaling participant model */
	localCallParticipantModel: LocalCallParticipantModel
}>()

const actorStore = useActorStore()
const breakoutRoomsStore = useBreakoutRoomsStore()
const participantActivityStore = useParticipantActivityStore()
const vuexStore = useStore()

const AUTO_LOWER_HAND_THRESHOLD = 3_000
const disableKeyboardShortcuts = OCP.Accessibility.disableKeyboardShortcuts()
useHotKey('r', toggleHandRaised)

let throttleTimer: ReturnType<typeof setTimeout> | undefined
let lowerHandDelay = AUTO_LOWER_HAND_THRESHOLD
let speakingTimestamp: number | null = null
let lowerHandTimeout: ReturnType<typeof setTimeout> | undefined

const supportedReactions = computed(() => getTalkConfig(props.token, 'call', 'supported-reactions') || [])
const hasReactionSupport = computed(() => supportedReactions.value && supportedReactions.value.length > 0)
const reactionsInSingleRow = computed(() => Math.ceil(supportedReactions.value.length / 2))

const conversation = computed(() => {
	return vuexStore.getters.conversation(props.token) || vuexStore.getters.dummyConversation
})
const canModerate = computed(() => [PARTICIPANT.TYPE.OWNER, PARTICIPANT.TYPE.MODERATOR, PARTICIPANT.TYPE.GUEST_MODERATOR]
	.includes(conversation.value.participantType))
const userIsInBreakoutRoomAndInCall = computed(() => conversation.value.objectType === CONVERSATION.OBJECT_TYPE.BREAKOUT_ROOM)
const isHandRaised = computed(() => props.localMediaModel.attributes.raisedHand.state === true)
const raiseHandButtonLabel = computed(() => {
	if (!isHandRaised.value) {
		return disableKeyboardShortcuts
			? t('spreed', 'Raise hand')
			: t('spreed', 'Raise hand (R)')
	}
	return disableKeyboardShortcuts
		? t('spreed', 'Lower hand')
		: t('spreed', 'Lower hand (R)')
})

const actionsLabel = computed(() => hasReactionSupport.value ? t('spreed', 'Send a reaction') : raiseHandButtonLabel.value)
const actionsVariant = computed(() => isHandRaised.value ? 'primary' : 'tertiary')

/**
 * Throttle reaction sending from a single use (to 1 reaction every 2 seconds)
 *
 * @param reaction emoji character to send
 */
function throttledSendReaction(reaction: string) {
	if (throttleTimer) {
		return
	}

	sendReaction(reaction)
	throttleTimer = setTimeout(() => {
		throttleTimer = undefined
	}, 2_000)
}

/**
 * Relay reaction via WebRTC and render on sender screen
 *
 * @param reaction emoji character to send
 */
function sendReaction(reaction: string) {
	// send reaction to other participants
	props.localCallParticipantModel.sendReaction(reaction)

	// show reaction to yourself
	emit('send-reaction', {
		model: props.localCallParticipantModel,
		reaction,
	})
}

/**
 * Toggle the hand raised state for the local media model and update the store.
 * If the user is in a breakout room, it also handles the request for assistance.
 */
function toggleHandRaised() {
	const newState = !isHandRaised.value
	props.localMediaModel.toggleHandRaised(newState)
	participantActivityStore.setParticipantHandRaised({
		sessionId: actorStore.sessionId!,
		raisedHand: props.localMediaModel.attributes.raisedHand,
	})

	// Handle breakout room assistance requests
	if (userIsInBreakoutRoomAndInCall.value && !canModerate.value) {
		const hasRaisedHands = Object.keys(participantActivityStore.raisedHands)
			.filter((sessionId) => sessionId !== actorStore.sessionId)
			.length !== 0

		if (hasRaisedHands) {
			return // Assistance is already requested by someone in the room
		}

		const hasAssistanceRequested = conversation.value.breakoutRoomStatus === CONVERSATION.BREAKOUT_ROOM_STATUS.STATUS_ASSISTANCE_REQUESTED
		if (newState && !hasAssistanceRequested) {
			breakoutRoomsStore.requestAssistance(props.token)
		} else if (!newState && hasAssistanceRequested) {
			breakoutRoomsStore.dismissRequestAssistance(props.token)
		}
	}
}

/* Auto-lower hand when speaking */
watch(() => props.localMediaModel.attributes.speaking, (speaking: boolean) => {
	if (lowerHandTimeout !== undefined && !speaking) {
		lowerHandDelay = Math.max(0, lowerHandDelay - (Date.now() - speakingTimestamp!))
		clearTimeout(lowerHandTimeout)
		lowerHandTimeout = undefined
		return
	}

	// User is not speaking OR timeout is already running OR hand is not raised
	if (!speaking || lowerHandTimeout !== undefined || !isHandRaised.value) {
		return
	}

	speakingTimestamp = Date.now()
	lowerHandTimeout = setTimeout(() => {
		lowerHandTimeout = undefined
		speakingTimestamp = null
		lowerHandDelay = AUTO_LOWER_HAND_THRESHOLD

		if (isHandRaised.value) {
			toggleHandRaised()
		}
	}, lowerHandDelay)
})
</script>

<template>
	<NcActions
		:variant="actionsVariant"
		:title="actionsLabel"
		:aria-label="actionsLabel"
		class="reaction">
		<template #icon>
			<IconHandBackLeft v-if="isHandRaised" :size="18" />
			<IconEmoticonOutline v-else :size="20" />
		</template>

		<NcActionCaption v-if="hasReactionSupport" class="k7-react__title" :name="t('spreed', 'Reactions')" />

		<NcActionButtonGroup
			v-if="hasReactionSupport"
			class="reaction__group"
			:style="{ '--reactions-in-single-row': reactionsInSingleRow }">
			<NcActionButton
				v-for="(reaction, index) in supportedReactions"
				:key="index"
				:aria-label="t('spreed', 'React with {reaction}', { reaction })"
				class="reaction__button"
				closeAfterClick
				@click="throttledSendReaction(reaction)">
				<template #icon>
					{{ reaction }}
				</template>
			</NcActionButton>
		</NcActionButtonGroup>

		<NcActionSeparator v-if="hasReactionSupport" />

		<NcActionButton
			:title="raiseHandButtonLabel"
			:aria-label="raiseHandButtonLabel"
			class="raise-hand__button"
			:class="{ 'raise-hand__button--on': isHandRaised }"
			closeAfterClick
			:variant="isHandRaised ? 'secondary' : 'tertiary'"
			@click="toggleHandRaised">
			<!-- The following icon is much bigger than all the others
				so we reduce its size -->
			<template #icon>
				<IconHandBackLeft v-if="isHandRaised" :size="18" />
				<IconHandBackLeftOutline v-else :size="18" />
			</template>
			{{ raiseHandButtonLabel }}
		</NcActionButton>
	</NcActions>
</template>

<style lang="scss">
// Шторка реакций v7. Поповер телепортируется в body, поэтому стили не scoped; метка — .reaction__group внутри поповера.
.v-popper__popper:has(.reaction__group) {
	.v-popper__inner { border: 0 !important; border-radius: 24px !important; background: var(--k7-bg2, var(--color-main-background)) !important; color: var(--k7-fg, inherit) !important; box-shadow: 0 18px 50px #0007, inset 0 0 0 1px var(--k7-line2, transparent) !important; }
	.v-popper__arrow-container { display: none; }
	ul { padding: 10px 12px calc(12px + env(safe-area-inset-bottom, 0px)); }
	.k7-react__title { color: var(--k7-fg2); font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; text-align: center; padding: 4px 0 6px; }
	.reaction__group .nc-button-group-content { display: grid !important; grid-template-columns: repeat(6, 1fr); gap: 8px !important; min-width: 0 !important; width: min(360px, calc(100vw - 48px)); padding: 4px 0; }
	.reaction__button { flex: none !important; width: auto !important; }
	.reaction__button .action-button, .reaction__button button {
		width: 100% !important; aspect-ratio: 1; min-width: 0; min-height: 0 !important; padding: 0 !important; border-radius: 50% !important; justify-content: center;
		background: var(--k7-pill) !important; box-shadow: inset 0 0 0 1px var(--k7-line2); font-size: 26px; line-height: 1;
		transition: transform .12s ease, background .12s ease; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
	}
	.reaction__button :is(.action-button__icon, .action-button__icon span) { font-size: 26px; line-height: 1; }
	.reaction__button :is(.action-button, button):active { transform: scale(.82); }
	@media (hover: hover) { .reaction__button :is(.action-button, button):hover { transform: scale(1.12); background: color-mix(in srgb, var(--k7-acc) 22%, var(--k7-pill)) !important; } }
	.raise-hand__button { margin-top: 6px; }
	.raise-hand__button :is(.action-button, button) {
		min-height: 52px; border-radius: 999px !important; justify-content: center; font-weight: 700; color: var(--k7-fg) !important;
		background: var(--k7-pill) !important; box-shadow: inset 0 0 0 1px var(--k7-line2); transition: transform .12s ease;
	}
	.raise-hand__button :is(.action-button, button):active { transform: scale(.97); }
	.raise-hand__button--on :is(.action-button, button) { background: var(--k7-grad) !important; color: #fff !important; box-shadow: 0 6px 18px color-mix(in srgb, var(--k7-acc2) 55%, transparent); }
	.raise-hand__button--on :is(.action-button__text, .material-design-icon) { color: #fff !important; }
	.raise-hand__button :is(.action-button__text) { font-weight: 700; }
}

// телефон: шторка снизу на всю ширину, с ручкой
@media (max-width: 600px) {
	.v-popper__popper:has(.reaction__group) {
		position: fixed !important; inset: auto 0 0 0 !important; transform: none !important; width: 100% !important;
		.v-popper__wrapper, .v-popper__inner { width: 100%; }
		.v-popper__inner { border-radius: 28px 28px 0 0 !important; }
		.v-popper__inner::before { content: ''; display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--k7-line2); margin: 8px auto 0; }
		.reaction__group .nc-button-group-content { width: 100%; }
		.reaction__button .action-button, .reaction__button button { font-size: 30px; }
	}
}
</style>
