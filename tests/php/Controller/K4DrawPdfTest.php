<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ket4tec (NAS_CLOUD#107): оригинал PDF беседы для страниц фона доски — права как у картинки

namespace OCA\Talk\Tests\php\Controller;

use OCA\Talk\Chat\ChatManager;
use OCA\Talk\Controller\K4DrawController;
use OCA\Talk\Participant;
use OCA\Talk\Room;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Comments\IComment;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\ICacheFactory;
use OCP\IConfig;
use OCP\IPreview;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Lock\ILockingProvider;
use OCP\Share\IManager as IShareManager;
use PHPUnit\Framework\MockObject\MockObject;
use Psr\Log\LoggerInterface;
use Test\TestCase;

class K4DrawPdfTest extends TestCase {
	private IAppConfig&MockObject $appConfig;
	private ChatManager&MockObject $chatManager;
	private IRootFolder&MockObject $rootFolder;

	private function controller(bool $cannotSeeChat): K4DrawController {
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->chatManager = $this->createMock(ChatManager::class);
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$c = new K4DrawController(
			'spreed', $this->createMock(IRequest::class), $this->appConfig, $this->rootFolder,
			$this->createMock(ITimeFactory::class), $this->createMock(LoggerInterface::class),
			$this->chatManager, $this->createMock(IShareManager::class),
			$this->createMock(IPreview::class), $this->createMock(ILockingProvider::class),
			$this->createMock(IConfig::class), $this->createMock(ICacheFactory::class), $this->createMock(IUserSession::class),
		);
		$room = $this->createMock(Room::class);
		$room->method('getToken')->willReturn('abc123');
		$participant = $this->createMock(Participant::class);
		$participant->method('cannotSeeChat')->willReturn($cannotSeeChat);
		$c->setRoom($room);
		$c->setParticipant($participant);
		return $c;
	}

	public function testGuestWithoutChatGetsNothingUnlessShown(): void {
		$ctrl = $this->controller(true);
		$this->appConfig->method('getAppValueString')->willReturn('[]');
		$this->chatManager->expects($this->never())->method('getComment');
		$this->assertSame(Http::STATUS_NOT_FOUND, $ctrl->chatPdf(5)->getStatus());
	}

	public function testShownButNotAFileMessageIs404(): void {
		$ctrl = $this->controller(true);
		$this->appConfig->method('getAppValueString')->willReturn('["m5"]');
		$this->chatManager->method('getComment')->willThrowException(new \Exception('нет такого'));
		$this->assertSame(Http::STATUS_NOT_FOUND, $ctrl->chatPdf(5)->getStatus());
	}

	public function testFileIdMessageWithoutShareServesPdf(): void {
		// NAS_CLOUD#107: новые вложения беседы — file_shared с fileId без share
		$ctrl = $this->controller(false);
		$c = $this->createMock(IComment::class);
		$c->method('getVerb')->willReturn(ChatManager::VERB_OBJECT_SHARED);
		$c->method('getMessage')->willReturn('{"message":"file_shared","parameters":{"fileId":"17221"}}');
		$this->chatManager->method('getComment')->willReturn($c);
		$file = $this->createMock(File::class);
		$file->method('getMimeType')->willReturn('application/pdf');
		$this->rootFolder->expects($this->once())->method('getFirstNodeById')->with(17221)->willReturn($file);
		$this->assertSame(Http::STATUS_OK, $ctrl->chatPdf(5)->getStatus());
	}

	public function testPdfRouteIsPublicNoCsrf(): void {
		$m = new \ReflectionMethod(K4DrawController::class, 'chatPdf');
		$this->assertNotEmpty($m->getAttributes(PublicPage::class));
		$this->assertNotEmpty($m->getAttributes(NoCSRFRequired::class));
	}
}
