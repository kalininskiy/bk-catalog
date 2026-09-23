#!/usr/bin/env python3
"""
Script to create small thumbnail versions of game screenshots (50px height)
for optimized loading in the games table.
"""

import os
from pathlib import Path
from PIL import Image
import argparse

def resize_image(input_path, output_path, height=50):
    """
    Resize image to specified height while maintaining aspect ratio.

    Args:
        input_path (str): Path to input image
        output_path (str): Path to output image
        height (int): Target height in pixels
    """
    try:
        with Image.open(input_path) as img:
            # Calculate new width to maintain aspect ratio
            aspect_ratio = img.width / img.height
            new_width = int(height * aspect_ratio)

            # Resize image
            resized_img = img.resize((new_width, height), Image.Resampling.LANCZOS)

            # Save with optimized quality for web
            if input_path.lower().endswith('.jpg') or input_path.lower().endswith('.jpeg'):
                resized_img.save(output_path, 'JPEG', quality=85, optimize=True)
            elif input_path.lower().endswith('.png'):
                # Convert to RGB if necessary and save as PNG
                if resized_img.mode in ('RGBA', 'LA', 'P'):
                    # Create white background for transparent images
                    background = Image.new('RGB', resized_img.size, (255, 255, 255))
                    if resized_img.mode == 'RGBA':
                        background.paste(resized_img, mask=resized_img.split()[-1])
                    else:
                        background.paste(resized_img)
                    resized_img = background
                resized_img.save(output_path, 'PNG', optimize=True)
            elif input_path.lower().endswith('.gif'):
                resized_img.save(output_path, 'GIF', optimize=True)
            else:
                # For other formats, convert to JPEG
                if resized_img.mode != 'RGB':
                    resized_img = resized_img.convert('RGB')
                resized_img.save(output_path, 'JPEG', quality=85, optimize=True)

            print(f"Resized: {input_path} -> {output_path}")

    except Exception as e:
        print(f"Error processing {input_path}: {e}")

def main():
    parser = argparse.ArgumentParser(description='Create small thumbnails of game screenshots')
    parser.add_argument('--height', type=int, default=50,
                       help='Target height for thumbnails in pixels (default: 50)')
    parser.add_argument('--input-dir', default='bk_games_screenshots',
                       help='Input directory containing screenshots (default: bk_games_screenshots)')
    parser.add_argument('--output-dir', default='bk_games_small_screenshots',
                       help='Output directory for thumbnails (default: bk_games_small_screenshots)')

    args = parser.parse_args()

    # Define paths
    script_dir = Path(__file__).parent
    input_dir = script_dir / args.input_dir
    output_dir = script_dir / args.output_dir

    # Supported image extensions
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'}

    # Create output directory if it doesn't exist
    output_dir.mkdir(exist_ok=True)

    # Process all images in input directory
    processed_count = 0
    if input_dir.exists():
        for file_path in input_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in image_extensions:
                output_path = output_dir / file_path.name
                resize_image(str(file_path), str(output_path), args.height)
                processed_count += 1
    else:
        print(f"Input directory {input_dir} does not exist!")
        return

    print(f"\nProcessing complete! Created {processed_count} thumbnail(s) in {output_dir}")

if __name__ == '__main__':
    main()
