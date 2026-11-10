<!--
  - SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div
		class="empty-call-view"
		:class="{
			'empty-call-view--sidebar': isSidebar,
			'empty-call-view--small': isSmall,
		}"
		data-theme-dark>
		<!-- ket4tec v7: значок ссылки над заголовком не показываем, остаётся только загрузка -->
		<component :is="emptyCallViewIcon" v-if="isConnecting || isSidebar" :size="isSidebar ? 32 : 64" class="empty-call-view__icon" />
		<h2>{{ title }}</h2>
		<template v-if="!isSmall">
			<p v-if="message" class="emptycontent-additional">
				{{ message }}
			</p>
			<NcButton
				v-if="showLink"
				variant="primary"
				class="empty-call-view__link"
				:title="t('spreed', 'Send link')"
				:aria-label="t('spreed', 'Send link')"
				@click.stop="handleCopyLink">
				<template #icon>
					<IconLink :size="20" />
				</template>
				{{ t('spreed', 'Send link') }}
			</NcButton>
		</template>
	</div>
</template>

<script>
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import IconAccountMultipleOutline from 'vue-material-design-icons/AccountMultipleOutline.vue'
import IconLink from 'vue-material-design-icons/Link.vue'
import IconPhoneOutline from 'vue-material-design-icons/PhoneOutline.vue'
import { useGetToken } from '../../../composables/useGetToken.ts'
import { CONVERSATION, PARTICIPANT } from '../../../constants.ts'
import { isConversationPhoneRoom } from '../../../utils/conversation.ts'
import { copyConversationLinkToClipboard, generateFullConversationLink } from '../../../utils/handleUrl.ts'

export default {

	name: 'EmptyCallView',

	components: {
		NcButton,
		NcLoadingIcon,
		IconAccountMultipleOutline,
		IconLink,
		IconPhoneOutline,
	},

	props: {
		isGrid: {
			type: Boolean,
			default: false,
		},

		isSidebar: {
			type: Boolean,
			default: false,
		},

		isSmall: {
			type: Boolean,
			default: false,
		},
	},

	setup() {
		return {
			token: useGetToken(),
		}
	},

	computed: {
		isConnecting() {
			return this.$store.getters.isConnecting(this.token)
		},

		conversation() {
			return this.$store.getters.conversation(this.token)
		},

		isGroupConversation() {
			return this.conversation && this.conversation.type === CONVERSATION.TYPE.GROUP
		},

		isPublicConversation() {
			return this.conversation && this.conversation.type === CONVERSATION.TYPE.PUBLIC
		},

		isOneToOneConversation() {
			return this.conversation?.type === CONVERSATION.TYPE.ONE_TO_ONE
				|| this.conversation?.type === CONVERSATION.TYPE.ONE_TO_ONE_FORMER
		},

		isPasswordRequestConversation() {
			return this.conversation && this.conversation.objectType === CONVERSATION.OBJECT_TYPE.VIDEO_VERIFICATION
		},

		isFileConversation() {
			return this.conversation && this.conversation.objectType === CONVERSATION.OBJECT_TYPE.FILE
		},

		isPhoneConversation() {
			return this.conversation && isConversationPhoneRoom(this.conversation)
		},

		canInviteOthers() {
			return this.conversation && (
				this.conversation.participantType === PARTICIPANT.TYPE.OWNER
				|| this.conversation.participantType === PARTICIPANT.TYPE.MODERATOR)
		},

		canInviteOthersInPublicConversations() {
			return this.canInviteOthers
				|| (this.conversation && this.conversation.participantType === PARTICIPANT.TYPE.GUEST_MODERATOR)
		},

		emptyCallViewIcon() {
			if (this.isConnecting) {
				return NcLoadingIcon
			} else if (this.isPhoneConversation) {
				return IconPhoneOutline
			} else {
				return this.isPublicConversation ? IconLink : IconAccountMultipleOutline
			}
		},

		title() {
			if (this.isConnecting) {
				return t('spreed', 'Connecting …')
			}
			if (this.isPhoneConversation) {
				return t('spreed', 'Calling …')
			}
			if (this.isOneToOneConversation) {
				// Rendered via Vue text interpolation - avoid double escaping to correctly render special characters
				return t('spreed', 'Waiting for {user} to join the call', { user: this.conversation.displayName }, { escape: false })
			}
			return t('spreed', 'Waiting for others')
		},

		message() {
			if (this.isConnecting) {
				return ''
			}

			if (this.isPasswordRequestConversation || this.isFileConversation) {
				return ''
			}

			if (!this.isGroupConversation && !this.isPublicConversation) {
				return ''
			}

			if (this.isGroupConversation && !this.canInviteOthers) {
				return ''
			}

			if (this.isPhoneConversation) {
				return ''
			}

			// ket4tec v7: без подсказки про «вкладку участников боковой панели» — на телефоне её нет; ссылка — кнопкой ниже
			return 
		},

		showLink() {
			return this.isPublicConversation && !this.isPasswordRequestConversation && !this.isFileConversation
		},
	},

	methods: {
		t,
		// ket4tec v7: телефон — системное «Поделиться» (как «Мой звонок»), компьютер — ссылка в буфер
		handleCopyLink() {
			if (navigator.share && matchMedia('(pointer: coarse)').matches) {
				navigator.share({ title: this.conversation?.displayName, url: generateFullConversationLink(this.token) }).catch((e) => {
					if (e?.name !== 'AbortError') {
						copyConversationLinkToClipboard(this.token)
					}
				})
				return
			}
			copyConversationLinkToClipboard(this.token)
		},
	},
}
</script>

<style lang="scss" scoped>

.empty-call-view {
	height: 100%;
	width: 100%;
	position: absolute;
	display: flex;
	flex-direction: column;
	align-content: center;
	justify-content: center;
	text-align: center;
	z-index: 1; // Otherwise the "Copy link" button is not clickable

	.icon {
		background-size: 64px;
		height: 64px;
		width: 64px;
		margin: 0 auto 15px;
	}

	button {
		margin: 4px auto;
	}

	&__icon,
	h2, p {
		color: var(--color-main-text);
	}

	&--sidebar {
		padding-bottom: 16px;

		h2, p {
			font-size: 90%;
		}

		.icon {
			transform: scale(0.7);
			margin-top: 0;
			margin-bottom: 0;
		}
	}

	&--small {
		border-radius: calc(var(--default-clickable-area) / 2);
		background-color: rgba(34, 34, 34, 0.8); /* Copy from the call view */
		padding: 8px;

		h2 {
			font-size: 1rem;
			font-weight: normal;
		}

		.icon {
			transform: none;
			margin-bottom: 0;
			background-size: 32px;
			height: 32px;
			width: 32px;
		}
	}
}

</style>
