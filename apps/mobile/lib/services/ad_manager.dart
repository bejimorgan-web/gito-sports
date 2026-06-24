import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'analytics_service.dart';

class AdManager {
  AdManager._();

  static bool _initialized = false;
  static BannerAd? _bannerAd;
  static InterstitialAd? _interstitialAd;
  static RewardedAd? _rewardedAd;
  static bool _isInterstitialLoading = false;
  static bool _isRewardedLoading = false;
  static const _analyticsService = MobileAnalyticsService();

  static const String bannerAdUnitId = 'ca-app-pub-3940256099942544/6300978111';
  static const String interstitialAdUnitId = 'ca-app-pub-3940256099942544/1033173712';
  static const String rewardedAdUnitId = 'ca-app-pub-3940256099942544/5224354917';

  static Future<void> initialize() async {
    if (_initialized) {
      return;
    }

    await MobileAds.instance.initialize();
    _initialized = true;
    _loadInterstitialAd();
    _loadRewardedAd();
  }

  static Future<BannerAd> loadBannerAd({AdSize size = AdSize.banner}) {
    _bannerAd?.dispose();

    final completer = Completer<BannerAd>();
    final banner = BannerAd(
      size: size,
      adUnitId: bannerAdUnitId,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (ad) {
          if (!completer.isCompleted) {
            completer.complete(ad as BannerAd);
          }
        },
        onAdFailedToLoad: (ad, error) {
          ad.dispose();
          if (!completer.isCompleted) {
            completer.completeError(error);
          }
        },
        onAdImpression: (ad) {
          unawaited(_analyticsService.trackAdEvent(eventType: 'ad_impression'));
        },
        onAdOpened: (ad) {
          unawaited(_analyticsService.trackAdEvent(eventType: 'ad_click'));
        },
      ),
    );

    banner.load();
    _bannerAd = banner;
    return completer.future;
  }

  static Future<void> _loadInterstitialAd() async {
    if (!_initialized || _interstitialAd != null || _isInterstitialLoading) {
      return;
    }

    _isInterstitialLoading = true;

    InterstitialAd.load(
      adUnitId: interstitialAdUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _isInterstitialLoading = false;
          _interstitialAd = ad;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              unawaited(_analyticsService.trackAdEvent(eventType: 'ad_impression'));
            },
            onAdClicked: (ad) {
              unawaited(_analyticsService.trackAdEvent(eventType: 'ad_click'));
            },
            onAdDismissedFullScreenContent: (ad) {
              ad.dispose();
              _interstitialAd = null;
              _loadInterstitialAd();
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              ad.dispose();
              _interstitialAd = null;
              _loadInterstitialAd();
            },
          );
        },
        onAdFailedToLoad: (error) {
          _isInterstitialLoading = false;
          _interstitialAd = null;
        },
      ),
    );
  }

  static Future<void> showInterstitial({String? matchId}) async {
    if (!_initialized) {
      return;
    }

    if (_interstitialAd == null) {
      await _loadInterstitialAd();
    }

    final ad = _interstitialAd;
    if (ad == null) {
      return;
    }

    _interstitialAd = null;
    ad.show();
  }

  static Future<void> _loadRewardedAd() async {
    if (!_initialized || _rewardedAd != null || _isRewardedLoading) {
      return;
    }

    _isRewardedLoading = true;

    RewardedAd.load(
      adUnitId: rewardedAdUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _isRewardedLoading = false;
          _rewardedAd = ad;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              unawaited(_analyticsService.trackAdEvent(eventType: 'ad_impression'));
            },
            onAdClicked: (ad) {
              unawaited(_analyticsService.trackAdEvent(eventType: 'ad_click'));
            },
            onAdDismissedFullScreenContent: (ad) {
              ad.dispose();
              _rewardedAd = null;
              _loadRewardedAd();
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              ad.dispose();
              _rewardedAd = null;
              _loadRewardedAd();
            },
          );
        },
        onAdFailedToLoad: (error) {
          _isRewardedLoading = false;
          _rewardedAd = null;
        },
      ),
    );
  }

  static Future<bool> showRewarded({String? matchId}) async {
    if (!_initialized) {
      return false;
    }

    if (_rewardedAd == null) {
      await _loadRewardedAd();
    }

    final ad = _rewardedAd;
    if (ad == null) {
      return false;
    }

    final completer = Completer<bool>();
    var rewarded = false;

    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdShowedFullScreenContent: (ad) {
        unawaited(_analyticsService.trackAdEvent(eventType: 'ad_impression', matchId: matchId));
      },
      onAdClicked: (ad) {
        unawaited(_analyticsService.trackAdEvent(eventType: 'ad_click', matchId: matchId));
      },
      onAdDismissedFullScreenContent: (ad) {
        ad.dispose();
        _rewardedAd = null;
        _loadRewardedAd();
        if (!completer.isCompleted) {
          completer.complete(rewarded);
        }
      },
      onAdFailedToShowFullScreenContent: (ad, error) {
        ad.dispose();
        _rewardedAd = null;
        _loadRewardedAd();
        if (!completer.isCompleted) {
          completer.complete(false);
        }
      },
    );

    _rewardedAd = null;
    ad.show(onUserEarnedReward: (ad, reward) {
      rewarded = true;
      unawaited(_analyticsService.trackAdEvent(
        eventType: 'reward_completed',
        matchId: matchId,
        metadata: {
          'rewardType': reward.type,
          'amount': reward.amount,
        },
      ));
    });

    return completer.future;
  }
}

class AdManagerBanner extends StatefulWidget {
  const AdManagerBanner({
    this.adSize = AdSize.banner,
    super.key,
  });

  final AdSize adSize;

  @override
  State<AdManagerBanner> createState() => _AdManagerBannerState();
}

class _AdManagerBannerState extends State<AdManagerBanner> {
  BannerAd? _bannerAd;
  bool _failedToLoad = false;

  @override
  void initState() {
    super.initState();
    _loadBanner();
  }

  Future<void> _loadBanner() async {
    try {
      final banner = await AdManager.loadBannerAd(size: widget.adSize);
      if (!mounted) {
        banner.dispose();
        return;
      }
      setState(() {
        _bannerAd = banner;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failedToLoad = true;
      });
    }
  }

  @override
  void dispose() {
    _bannerAd?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_failedToLoad || _bannerAd == null) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      width: widget.adSize.width.toDouble(),
      height: widget.adSize.height.toDouble(),
      child: AdWidget(ad: _bannerAd!),
    );
  }
}
