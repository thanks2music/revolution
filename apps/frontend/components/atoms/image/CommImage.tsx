"use client";

// component
import Image from "next/image";

const CommImage = ({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) => {
  // srcがnullまたは空文字の場合はプレースホルダーを表示
  if (!src) {
    return (
      <div className={`relative inline-block bg-gray-200 flex items-center justify-center ${className}`}>
        <span className="text-gray-500 text-sm">No Image</span>
      </div>
    );
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        style={{
          objectFit: "cover",
        }}
      />
    </div>
  );
};

export default CommImage;
