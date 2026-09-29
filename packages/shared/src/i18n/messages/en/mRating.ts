import type { trMRating } from '../tr/mRating';

export const enMRating: Record<keyof typeof trMRating, string> = {
  'mRating.score.veryBad': 'Very bad',
  'mRating.score.bad': 'Bad',
  'mRating.score.average': 'Average',
  'mRating.score.good': 'Good',
  'mRating.score.great': 'Great',
  'mRating.errors.submitFailed': 'Rating could not be submitted.',
  'mRating.linkOpenFailedTitle': 'Link could not be opened',
  'mRating.linkOpenFailedBody': 'The Google review page could not be opened.',
  'mRating.thankYou': 'Thank you!',
  'mRating.ratingSaved': 'Your rating has been saved.',
  'mRating.shareExperiencePrompt': 'Would you like to share your experience with others?',
  'mRating.googleReviewHint': 'You can leave a short review on Google if you like. It is entirely optional.',
  'mRating.leaveGoogleReview': 'Leave a Google review',
  'mRating.done': 'Done',
  'mRating.howWasYourSession': 'How was your session?',
  'mRating.a11y.starRating': '{value} stars: {label}',
  'mRating.commentLabel': 'Comment (optional)',
  'mRating.commentPlaceholder': 'Describe your experience...',
  'mRating.send': 'Send',
};
