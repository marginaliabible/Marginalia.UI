import { render, screen, fireEvent } from '@testing-library/react';
import { VerseTextList } from './VersePreview';

describe('VerseTextList overflow', () => {
  it('shows at most five verses and an overflow control', () => {
    const onOverflowClick = jest.fn();
    const verses = [1, 2, 3, 4, 5, 6, 7].map((verse) => ({
      verse,
      text: `Text ${verse}`,
    }));

    render(
      <VerseTextList
        verses={verses}
        totalVerseCount={7}
        onOverflowClick={onOverflowClick}
      />
    );

    expect(screen.getByText('Text 5')).toBeTruthy();
    expect(screen.queryByText('Text 6')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '...' }));
    expect(onOverflowClick).toHaveBeenCalledTimes(1);
  });

  it('does not show overflow when five or fewer verses are selected', () => {
    render(
      <VerseTextList
        verses={[
          { verse: 1, text: 'One' },
          { verse: 2, text: 'Two' },
        ]}
        totalVerseCount={2}
      />
    );

    expect(screen.queryByText('...')).toBeNull();
  });
});
