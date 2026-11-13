<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2024 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Events;

use OCA\Talk\Participant;
use OCA\Talk\Room;

/**
 * @psalm-method \DateTime getOldValue()
 */
abstract class ACallEndedEvent extends ARoomModifiedEvent {
	public function __construct(
		Room $room,
		?Participant $actor,
		\DateTime $oldActiveSince,
		/** ket4tec (NAS_CLOUD#129): момент, когда звонок опустел (отсроченное завершение), для длительности */
		private readonly ?int $endedAt = null,
	) {
		parent::__construct(
			$room,
			self::PROPERTY_ACTIVE_SINCE,
			null,
			$oldActiveSince,
			$actor
		);
	}

	public function getEndedAt(): ?int {
		return $this->endedAt;
	}

	public function getCallFlag(): int {
		return Participant::FLAG_DISCONNECTED;
	}
}
