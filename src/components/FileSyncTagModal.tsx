import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import CreatableSelect from 'react-select/creatable';
import type { MultiValue } from 'react-select';
import { createMultiSelectStyles } from './sharedMultiSelectStyles';
import { assignResourceTagColors, getResourceTagColors } from '../utils/resourceTagColors';
import { useResourceTagColors } from '../hooks/useResourceTagColors';
import './FileSyncTagModal.scss';

const DEFAULT_SEED_TAGS = ['Teaching', 'Research Materials', 'Syllabus'];

interface TagOption {
  value: string;
  label: string;
}

interface FileSyncTagModalProps {
  itemLabel: string;
  initialTags: string[];
  onDone: (tags: string[]) => void;
  onClose: () => void;
}

const FileSyncTagModal: React.FC<FileSyncTagModalProps> = ({ itemLabel, initialTags, onDone, onClose }) => {
  const [seedTags] = useState(() => (
    Object.keys(getResourceTagColors()).length === 0 ? DEFAULT_SEED_TAGS : undefined
  ));
  const tagColors = useResourceTagColors(seedTags);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);

  const options = useMemo<TagOption[]>(() => {
    const names = new Set([...tagColors.keys(), ...selectedTags]);
    return Array.from(names)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ value: name, label: name }));
  }, [tagColors, selectedTags]);

  const selectedOptions = useMemo<TagOption[]>(() => {
    return selectedTags.map((tag) => ({ value: tag, label: tag }));
  }, [selectedTags]);

  const handleChange = (next: MultiValue<TagOption>) => {
    setSelectedTags(next.map((option) => option.value));
  };

  const handleCreateOption = (rawName: string) => {
    const name = rawName.trim();
    if (!name) {
      return;
    }

    assignResourceTagColors([name]);
    setSelectedTags((current) => (current.includes(name) ? current : [...current, name]));
  };

  const formatOptionLabel = (option: TagOption) => {
    const color = tagColors.get(option.value) ?? '#6c757d';
    return (
      <span className="file-sync-tag-option">
        <span className="file-sync-tag-dot" style={{ backgroundColor: color }} aria-hidden="true"></span>
        <span>{option.label}</span>
      </span>
    );
  };

  const modal = (
    <>
      <div className="modal-backdrop fade show file-sync-tag-modal-backdrop" onClick={onClose} />
      <div className="modal fade show d-block file-sync-tag-modal" tabIndex={-1} aria-modal="true" role="dialog">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow border-0">
            <div className="modal-header">
              <h2 className="modal-title h6 mb-0">Tags for {itemLabel}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
            </div>
            <div className="modal-body">
              <CreatableSelect
                isMulti
                options={options}
                value={selectedOptions}
                onChange={handleChange}
                onCreateOption={handleCreateOption}
                formatOptionLabel={formatOptionLabel}
                placeholder="Select or create tags..."
                classNamePrefix="file-sync-tag-select"
                className="file-sync-tag-select"
                isClearable={false}
                closeMenuOnSelect={false}
                aria-label="Tag selection"
                inputId="fileSyncTagInput"
                styles={createMultiSelectStyles<TagOption>()}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onDone(selectedTags)}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default FileSyncTagModal;
