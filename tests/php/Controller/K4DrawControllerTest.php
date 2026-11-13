<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Controller;

use OCA\Talk\Controller\K4DrawController;
use OCA\Talk\Model\Attendee;
use OCA\Talk\Participant;
use OCA\Talk\Room;
use OCP\AppFramework\Http;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\ICache;
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

class K4DrawControllerTest extends TestCase {
	private IRequest&MockObject $request;
	private IAppConfig&MockObject $appConfig;
	private IUserSession&MockObject $userSession;
	/** @var array<string, mixed> */
	private array $store = [];

	protected function setUp(): void {
		parent::setUp();
		$this->store = [];
		$this->request = $this->createMock(IRequest::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->userSession = $this->createMock(IUserSession::class);
	}

	private function controller(string $actorType, string $actorId): K4DrawController {
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturnCallback(fn ($k) => $this->store[$k] ?? null);
		$cache->method('set')->willReturnCallback(function ($k, $v) {
			$this->store[$k] = $v;
			return true;
		});
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('createDistributed')->willReturn($cache);
		$c = new K4DrawController(
			'spreed', $this->request, $this->appConfig, $this->createMock(IRootFolder::class),
			$this->createMock(ITimeFactory::class), $this->createMock(LoggerInterface::class),
			$this->createMock(\OCA\Talk\Chat\ChatManager::class), $this->createMock(IShareManager::class),
			$this->createMock(IPreview::class), $this->createMock(ILockingProvider::class),
			$this->createMock(IConfig::class), $factory, $this->userSession,
		);
		$room = $this->createMock(Room::class);
		$room->method('getToken')->willReturn('abc123');
		$attendee = new Attendee();
		$attendee->setActorType($actorType);
		$attendee->setActorId($actorId);
		$attendee->setDisplayName('Имя');
		$participant = $this->createMock(Participant::class);
		$participant->method('getAttendee')->willReturn($attendee);
		$c->setRoom($room);
		$c->setParticipant($participant);
		return $c;
	}

	public function testFeedForbiddenForGuestAndForeignUser(): void {
		$this->appConfig->method('getAppValueArray')->willReturn(['andrey']);
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller('guests', 'andrey')->calllogFeed()->getStatus());
		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller('users', 'bob')->calllogFeed()->getStatus());
	}

	public function testFeedFiltersBySince(): void {
		$this->appConfig->method('getAppValueArray')->willReturn(['andrey']);
		$this->store['k4calllog/abc123'] = [['t' => 1.0, 'k' => 'a'], ['t' => 5.0, 'k' => 'b']];
		$r = $this->controller('users', 'andrey')->calllogFeed(2.0);
		$this->assertSame(Http::STATUS_OK, $r->getStatus());
		$this->assertSame(['b'], array_column($r->getData()['events'], 'k'));
	}

	public function testPreDropsForeignKindsAndRingIsTrimmed(): void {
		$this->appConfig->method('getAppValueArray')->willReturn(['andrey']);
		$ctrl = $this->controller('guests', 'x');
		$ev = fn (string $k) => ['t' => 1, 'k' => $k, 'd' => []];
		$this->request->method('getParams')->willReturn(['c' => 'ab1c2', 'sent' => 1, 'ev' => [$ev('page_load'), $ev('call_joined')]]);
		$r = $ctrl->calllogPre();
		$this->assertSame(['n' => 1], $r->getData());
		$this->assertSame('_ab1c2', $this->store['k4calllog/abc123'][0]['sess']);
		$this->assertSame('до входа', $this->store['k4calllog/abc123'][0]['name']);
		$this->store['k4calllog/abc123'] = array_fill(0, 299, ['t' => 0.0, 'k' => 'old']);
		$ctrl->calllogPre();
		$ctrl->calllogPre();
		$this->assertCount(300, $this->store['k4calllog/abc123']);
	}

	public function testPreRejectsTooManyAndTooBig(): void {
		$ctrl = $this->controller('guests', 'x');
		$e = ['t' => 1, 'k' => 'net', 'd' => []];
		$this->request->method('getParams')->willReturnOnConsecutiveCalls(
			['c' => 'ab1c2', 'ev' => array_fill(0, 21, $e)],
			['c' => 'ab1c2', 'ev' => [['t' => 1, 'k' => 'net', 'd' => ['a' => str_repeat('x', 9000)]]]],
		);
		$this->assertSame(Http::STATUS_BAD_REQUEST, $ctrl->calllogPre()->getStatus());
		$this->assertSame(Http::STATUS_BAD_REQUEST, $ctrl->calllogPre()->getStatus());
	}

	public function testNoRingWhenTestmodeEmpty(): void {
		$this->appConfig->method('getAppValueArray')->willReturn([]);
		$this->request->method('getParams')->willReturn(['c' => 'ab1c2', 'ev' => [['t' => 1, 'k' => 'net', 'd' => []]]]);
		$this->controller('guests', 'x')->calllogPre();
		$this->assertArrayNotHasKey('k4calllog/abc123', $this->store);
	}

	public function testPreEntriesCappedAt50(): void {
		$this->appConfig->method('getAppValueArray')->willReturn(['andrey']);
		$this->store['k4calllog/abc123'] = array_merge(
			[['t' => 0.0, 'sess' => 'real01', 'k' => 'real']],
			array_fill(0, 60, ['t' => 1.0, 'sess' => '_ab1c2', 'k' => 'net']),
		);
		$this->request->method('getParams')->willReturn(['c' => 'ab1c2', 'ev' => [['t' => 1, 'k' => 'net', 'd' => []]]]);
		$this->controller('guests', 'x')->calllogPre();
		$ring = $this->store['k4calllog/abc123'];
		$this->assertCount(51, $ring);
		$this->assertSame('real', $ring[0]['k']);
	}

	public function testFeedHasNoAdminRequired(): void {
		$attrs = (new \ReflectionMethod(K4DrawController::class, 'calllogFeed'))->getAttributes(\OCP\AppFramework\Http\Attribute\NoAdminRequired::class);
		$this->assertNotEmpty($attrs);
	}
}
