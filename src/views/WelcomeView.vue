<!--
  - SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script lang="ts" setup>
import { showError } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from 'vuex'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import IconPlus from 'vue-material-design-icons/Plus.vue'
import IconTalk from '../../img/app-dark.svg?raw'
import { getTalkConfig } from '../services/CapabilitiesManager.ts'
import { EventBus } from '../services/EventBus.ts'

// ket4tec (NAS_CLOUD#332): штатный экран-«панель» (встречи/упоминания/напоминания) убран, одинаково для всех ролей
const canStartConversations = getTalkConfig('local', 'conversations', 'can-create')

const store = useStore()
const router = useRouter()
const route = useRoute()

const isCreatingConversationForCallUser = ref(false)
const callUser = computed(() => route.query.callUser as string)

const text = computed(() => {
	if (isCreatingConversationForCallUser.value) {
		return {
			name: t('spreed', 'Creating and joining a conversation with "{userid}"', { userid: callUser.value ?? '' }),
			description: '',
		}
	}

	return {
		name: 'Выберите обсуждение',
		description: 'Откройте обсуждение из списка или начните новое.',
	}
})

watchEffect(async () => {
	if (callUser.value) {
		try {
			// Try to find an existing conversation
			const conversation = store.getters.getConversationForUser(callUser.value)
			if (conversation) {
				router.push({ name: 'conversation', params: { token: conversation.token } })
				return
			}

			// Create a new one-to-one conversation
			isCreatingConversationForCallUser.value = true
			const newConversation = await store.dispatch('createOneToOneConversation', callUser.value)
			router.push({ name: 'conversation', params: { token: newConversation.token } })
		} catch (error) {
			showError(t('spreed', 'Error while joining the conversation'))
			console.error(error)
			router.push({ name: 'notfound' })
		}

		isCreatingConversationForCallUser.value = false
	}
})
</script>

<template>
	<NcEmptyContent
		class="empty-view k7-welcome"
		:name="text.name"
		:description="text.description">
		<template #icon>
			<NcLoadingIcon v-if="isCreatingConversationForCallUser" />
			<NcIconSvgWrapper v-else :svg="IconTalk" />
		</template>
		<template v-if="canStartConversations && !isCreatingConversationForCallUser" #action>
			<NcButton variant="primary" @click="EventBus.emit('new-conversation-dialog:show')">
				<template #icon>
					<IconPlus :size="20" />
				</template>
				Новое обсуждение
			</NcButton>
		</template>
	</NcEmptyContent>
</template>

<style lang="scss" scoped>
.k7-welcome {
	height: 100%;
	padding: calc(var(--default-grid-baseline) * 4);
}
</style>
