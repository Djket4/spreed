<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Events;

use OCP\EventDispatcher\Event;
use OCP\Files\File;

/** Optional, version 1 extension for a specific recording transcription. */
class BeforeRecordingTranscriptionScheduledEvent extends Event {
	private ?string $taskTypeId = null;
	private ?string $job = null;
	private bool $localOnly = false;

	public function __construct(
		public readonly string $owner,
		public readonly string $roomToken,
		public readonly File $recording,
	) {
		parent::__construct();
	}

	/** Select a registered task type with AudioToText-compatible input/output and an opaque job input. */
	public function select(string $taskTypeId, string $job, bool $localOnly = false): void {
		if (!preg_match('/\A[A-Za-z0-9_.:-]{1,128}\z/D', $taskTypeId)
			|| !preg_match('/\A[A-Za-z0-9_-]{1,128}\z/D', $job)) {
			throw new \InvalidArgumentException('Invalid task selection');
		}
		$this->taskTypeId = $taskTypeId;
		$this->job = $job;
		$this->localOnly = $this->localOnly || $localOnly;
	}

	public function getTaskTypeId(): ?string {
		return $this->taskTypeId;
	}

	public function getJob(): ?string {
		return $this->job;
	}
	/** Mark a configured scope before receipt or model lookup. */
	public function requireLocalOnly(): void {
		$this->localOnly = true;
	}

	public function isLocalOnly(): bool {
		return $this->localOnly;
	}

}
