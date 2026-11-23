<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Events;

use OCP\EventDispatcher\Event;
use OCP\Files\File;

/** Optional, version 1 extension; only the saved file content may be changed. */
class BeforeRecordingTranscriptSavedEvent extends Event {
	private string $fileContent;

	public function __construct(
		public readonly string $owner,
		public readonly string $roomToken,
		public readonly File $recording,
		public readonly string $plainTranscript,
		public readonly ?string $taskTypeId,
		public readonly ?string $job,
	) {
		parent::__construct();
		$this->fileContent = $plainTranscript;
	}

	public function setFileContent(string $content): void {
		if ($content === '') {
			throw new \InvalidArgumentException('Empty transcript');
		}
		$this->fileContent = $content;
	}

	public function getFileContent(): string {
		return $this->fileContent;
	}
}
