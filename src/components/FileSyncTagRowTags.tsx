import React from 'react';

interface FileSyncTagRowTagsProps {
  effectiveTags: string[];
  ownTags: string[];
  tagColors: ReadonlyMap<string, string>;
  flashAddButton?: boolean;
  onAdd: (event: React.MouseEvent) => void;
  onEditOwn: (event: React.MouseEvent) => void;
  onFlashEnd?: () => void;
}

const FileSyncTagRowTags: React.FC<FileSyncTagRowTagsProps> = ({
  effectiveTags,
  ownTags,
  tagColors,
  flashAddButton = false,
  onAdd,
  onEditOwn,
  onFlashEnd,
}) => {
  const ownTagSet = new Set(ownTags);

  return (
    <>
      {effectiveTags.map((tag) => {
        const color = tagColors.get(tag) ?? '#6c757d';
        const isOwn = ownTagSet.has(tag);
        const style = { ['--resource-tag-color' as '--resource-tag-color']: color } as React.CSSProperties;

        return (
          <button
            key={tag}
            type="button"
            className={`cloud-folder-tag-chip${isOwn ? '' : ' is-inherited'}`}
            style={style}
            title={isOwn ? tag : `${tag} (inherited)`}
            onClick={onEditOwn}
          >
            {tag}
          </button>
        );
      })}
      <button
        type="button"
        className={`btn btn-outline-secondary btn-sm cloud-folder-tag-add-btn${flashAddButton ? ' is-flashing' : ''}`}
        onClick={onAdd}
        onAnimationEnd={flashAddButton ? onFlashEnd : undefined}
      >
        {effectiveTags.length === 0 ? '+ Tags' : '+'}
      </button>
    </>
  );
};

export default FileSyncTagRowTags;
