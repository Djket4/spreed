<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Events;

use OCA\Talk\Events\BeforeRecordingTranscriptionScheduledEvent;
use OCA\Talk\Events\BeforeRecordingTranscriptSavedEvent;
use OCP\Files\File;
use Test\TestCase;

class RecordingExtensionEventsTest extends TestCase {
	public function testSelectionIsOptionalAndAtomic(): void {
		$file = $this->createMock(File::class);
		$event = new BeforeRecordingTranscriptionScheduledEvent('owner', 'room1234', $file);
		$this->assertNull($event->getTaskTypeId());
		$this->assertNull($event->getJob());
		$event->select('local:recording', 'job_123');
		$this->assertSame('local:recording', $event->getTaskTypeId());
		$this->assertSame('job_123', $event->getJob());
		$this->assertSame($file, $event->recording);
		try {
			$event->select('local:recording', '../bad');
			$this->fail('Invalid job must be rejected');
		} catch (\InvalidArgumentException $e) {
			$this->assertSame('local:recording', $event->getTaskTypeId());
			$this->assertSame('job_123', $event->getJob());
		}
	}

	public function testTranscriptKeepsOriginalPlainAndTaskBinding(): void {
		$file = $this->createMock(File::class);
		$event = new BeforeRecordingTranscriptSavedEvent('owner', 'room1234', $file, 'plain', 'local:recording', 'job_123');
		$this->assertSame('plain', $event->getFileContent());
		$event->setFileContent('named');
		$this->assertSame('plain', $event->plainTranscript);
		$this->assertSame('named', $event->getFileContent());
		$this->assertSame('local:recording', $event->taskTypeId);
		$this->assertSame('job_123', $event->job);
		$this->expectException(\InvalidArgumentException::class);
		$event->setFileContent('');
	}
}
